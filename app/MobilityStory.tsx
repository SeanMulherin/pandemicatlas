"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

export interface MobilityStoryCounty {
  fips: string;
  state: string;
  county: string;
  inbound: number;
  outbound: number;
  total: number;
  balance: number;
}

export interface MobilityCovidDatum {
  date: string;
  casesAvgPer100k: number;
  deathsAvgPer100k: number;
}

interface PulseRow {
  weekStart: string;
  weekEnd: string;
  totalObserved: number;
  withinCountyObserved: number;
  intrastateCrossCountyObserved: number;
  interstateObserved: number;
  crossCountyObserved: number;
  seasonalWeek: number;
  totalIndex: number;
  withinCountyIndex: number;
  crossCountyIndex: number;
}

interface MobilityDynamicsMetadata {
  version: number;
  buildId: string;
  binaryHeaderBytes: number;
  binaryBytes: number;
  fieldCount: number;
  fields: string[];
  layout: string;
  weekCount: number;
  countyCount: number;
  coverageStart: string;
  coverageEnd: string;
  geometryBuildId: string;
  balanceCap: number;
  pulseBaseline: string;
  pulse: PulseRow[];
  methodology: {
    countyFields: string;
    balance: string;
    caveat: string;
  };
}

interface CountyGeometry {
  fips: string;
  name: string;
  state: string;
  path: string;
}

interface CountyMapMetadata {
  buildId: string;
  countyCount: number;
  geometry: {
    width: number;
    height: number;
    counties: CountyGeometry[];
    stateBordersPath: string;
    nationPath: string;
  };
}

interface MobilityDynamicsAssets {
  metadata: MobilityDynamicsMetadata;
  values: Uint32Array;
  map: CountyMapMetadata;
}

interface CountyPathCache {
  counties: Path2D[];
  countyOutlines: Path2D;
  stateBorders: Path2D;
  nation: Path2D;
  picker: HTMLCanvasElement;
}

interface CanvasDimensions {
  width: number;
  height: number;
}

type CovidMetric = "cases" | "deaths";

interface MobilityStoryProps {
  counties: MobilityStoryCounty[];
  focusState: string;
  onFocusState: (state: string) => void;
  covidSeries: MobilityCovidDatum[];
  covidMetric: CovidMetric;
  timelineHost: HTMLElement | null;
}

const ALL_STATES = "All states";
const DAY_MS = 86_400_000;
const INK = "#15191e";
const INK_FAINT = "#737575";
const PAPER = "#fffdf7";
const BLUE = "#126785";
const RED = "#a9363e";
const GOLD = "#8a5a00";
const RULE = "rgba(21, 25, 30, 0.18)";
const FLOW_FIELDS = 2;

/*
  Mobility chart map:
  1. Signed geography — weekly county net balance, blue inbound / red outbound.
  2. Trend — selected county weekly inbound and outbound observations.
  3. Relationship — cross-county mobility at t versus national incidence at t + lag.
*/

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const weekFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatCompact(value: number): string {
  return compactFormatter.format(value);
}

function formatWeek(row: PulseRow): string {
  return `${weekFormatter.format(new Date(`${row.weekStart}T00:00:00Z`))}–${weekFormatter.format(new Date(`${row.weekEnd}T00:00:00Z`))}`;
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${formatCompact(value)}`;
}

function useCanvasDimensions(ref: React.RefObject<HTMLCanvasElement | null>): CanvasDimensions {
  const [dimensions, setDimensions] = useState<CanvasDimensions>({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const update = () => {
      const rectangle = canvas.getBoundingClientRect();
      setDimensions({
        width: Math.max(1, Math.round(rectangle.width)),
        height: Math.max(1, Math.round(rectangle.height)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [ref]);

  return dimensions;
}

function prepareCanvas(
  canvas: HTMLCanvasElement,
  dimensions: CanvasDimensions,
): CanvasRenderingContext2D | null {
  const context = canvas.getContext("2d");
  if (!context || dimensions.width <= 0 || dimensions.height <= 0) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(dimensions.width * ratio);
  canvas.height = Math.round(dimensions.height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, dimensions.width, dimensions.height);
  return context;
}

function createPathCache(metadata: CountyMapMetadata): CountyPathCache | null {
  if (typeof document === "undefined" || typeof Path2D === "undefined") return null;
  const counties = metadata.geometry.counties.map((county) => new Path2D(county.path));
  const countyOutlines = new Path2D(metadata.geometry.counties.map((county) => county.path).join(""));
  const stateBorders = new Path2D(metadata.geometry.stateBordersPath);
  const nation = new Path2D(metadata.geometry.nationPath);
  const picker = document.createElement("canvas");
  picker.width = metadata.geometry.width;
  picker.height = metadata.geometry.height;
  const context = picker.getContext("2d", { willReadFrequently: true });
  if (context) {
    context.imageSmoothingEnabled = false;
    counties.forEach((path, index) => {
      const code = index + 1;
      context.fillStyle = `rgb(${code & 255}, ${(code >> 8) & 255}, ${(code >> 16) & 255})`;
      context.fill(path);
    });
  }
  return { counties, countyOutlines, stateBorders, nation, picker };
}

function countyAtPointer(
  event: ReactPointerEvent<HTMLCanvasElement>,
  metadata: CountyMapMetadata,
  paths: CountyPathCache,
): number | null {
  const rectangle = event.currentTarget.getBoundingClientRect();
  if (rectangle.width <= 0 || rectangle.height <= 0) return null;
  const x = Math.max(0, Math.min(
    metadata.geometry.width - 1,
    Math.floor(((event.clientX - rectangle.left) / rectangle.width) * metadata.geometry.width),
  ));
  const y = Math.max(0, Math.min(
    metadata.geometry.height - 1,
    Math.floor(((event.clientY - rectangle.top) / rectangle.height) * metadata.geometry.height),
  ));
  const context = paths.picker.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
  const index = red + (green << 8) + (blue << 16) - 1;
  return index >= 0 && index < metadata.countyCount ? index : null;
}

function flowOffset(weekIndex: number, countyIndex: number, countyCount: number): number {
  return (weekIndex * countyCount + countyIndex) * FLOW_FIELDS;
}

function pointerIndex(
  event: { clientX: number },
  canvas: HTMLCanvasElement,
  count: number,
  left: number,
  right: number,
): number {
  const rectangle = canvas.getBoundingClientRect();
  const x = event.clientX - rectangle.left;
  const progress = Math.max(0, Math.min(1, (x - left) / Math.max(1, rectangle.width - left - right)));
  return Math.round(progress * Math.max(0, count - 1));
}

function MobilityTimelineControls({
  pulse,
  weekIndex,
  isPlaying,
  onWeekIndex,
  onTogglePlayback,
}: {
  pulse: PulseRow[];
  weekIndex: number;
  isPlaying: boolean;
  onWeekIndex: (index: number) => void;
  onTogglePlayback: () => void;
}) {
  const activeWeek = pulse[weekIndex];
  const startDate = pulse[0]?.weekStart;
  const endDate = pulse.at(-1)?.weekEnd;
  return (
    <div className="mobility-timeline" role="group" aria-label="Weekly mobility animation controls">
      <button
        type="button"
        onClick={onTogglePlayback}
        aria-label={isPlaying ? "Pause weekly mobility animation" : "Play weekly mobility animation"}
      >
        <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <div className="mobility-timeline-readout" aria-live={isPlaying ? "off" : "polite"}>
        <span>Viewing week</span>
        <strong>{activeWeek ? formatWeek(activeWeek) : ""}</strong>
      </div>
      <div className="mobility-timeline-range">
        <time dateTime={startDate}>
          <span className="sr-only">Archive start: </span>
          {startDate ? weekFormatter.format(new Date(`${startDate}T00:00:00Z`)) : ""}
        </time>
        <input
          type="range"
          aria-label="Mobility week"
          min={0}
          max={Math.max(0, pulse.length - 1)}
          value={weekIndex}
          onChange={(event) => onWeekIndex(Number(event.target.value))}
          aria-valuetext={activeWeek ? formatWeek(activeWeek) : ""}
        />
        <time dateTime={endDate}>
          <span className="sr-only">Archive end: </span>
          {endDate ? weekFormatter.format(new Date(`${endDate}T00:00:00Z`)) : ""}
        </time>
      </div>
    </div>
  );
}

function AnimatedCountyFlowMap({
  assets,
  paths,
  countiesByFips,
  weekIndex,
  selectedFips,
  isPlaying,
  onSelectedFips,
}: {
  assets: MobilityDynamicsAssets;
  paths: CountyPathCache;
  countiesByFips: Map<string, MobilityStoryCounty>;
  weekIndex: number;
  selectedFips: string;
  isPlaying: boolean;
  onSelectedFips: (fips: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dimensions = useCanvasDimensions(canvasRef);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const selectedIndex = useMemo(
    () => Math.max(0, assets.map.geometry.counties.findIndex((county) => county.fips === selectedFips)),
    [assets.map.geometry.counties, selectedFips],
  );
  const detailIndex = hoveredIndex ?? selectedIndex;
  const detailGeometry = assets.map.geometry.counties[detailIndex];
  const detailOffset = flowOffset(weekIndex, detailIndex, assets.metadata.countyCount);
  const detailInbound = assets.values[detailOffset] ?? 0;
  const detailOutbound = assets.values[detailOffset + 1] ?? 0;
  const detailBalance = detailInbound - detailOutbound;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width <= 0 || dimensions.height <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const outputWidth = Math.max(1, Math.round(dimensions.width * ratio));
    const outputHeight = Math.max(1, Math.round(dimensions.height * ratio));
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(
      outputWidth / assets.map.geometry.width,
      0,
      0,
      outputHeight / assets.map.geometry.height,
      0,
      0,
    );
    context.fillStyle = PAPER;
    context.fillRect(0, 0, assets.map.geometry.width, assets.map.geometry.height);
    const capLog = Math.log1p(Math.max(1, assets.metadata.balanceCap));

    paths.counties.forEach((path, countyIndex) => {
      const offset = flowOffset(weekIndex, countyIndex, assets.metadata.countyCount);
      const inbound = assets.values[offset] ?? 0;
      const outbound = assets.values[offset + 1] ?? 0;
      const balance = inbound - outbound;
      if (balance === 0) {
        context.fillStyle = "#ebe8df";
      } else {
        const strength = Math.log1p(Math.min(Math.abs(balance), assets.metadata.balanceCap)) / capLog;
        const alpha = 0.12 + strength * 0.78;
        context.fillStyle = balance > 0
          ? `rgba(18, 103, 133, ${alpha})`
          : `rgba(169, 54, 62, ${alpha})`;
      }
      context.fill(path);
    });

    context.strokeStyle = "rgba(21, 25, 30, 0.22)";
    context.lineWidth = 0.35;
    context.stroke(paths.countyOutlines);
    context.strokeStyle = "rgba(21, 25, 30, 0.7)";
    context.lineWidth = 1.1;
    context.stroke(paths.stateBorders);
    context.strokeStyle = INK;
    context.lineWidth = 1.5;
    context.stroke(paths.nation);
    context.strokeStyle = GOLD;
    context.lineWidth = 2.8;
    context.stroke(paths.counties[detailIndex]);
  }, [assets, detailIndex, dimensions, paths, weekIndex]);

  const handlePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const county = countyAtPointer(event, assets.map, paths);
    setHoveredIndex((current) => current === county ? current : county);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    let next = selectedIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (selectedIndex + 1) % assets.metadata.countyCount;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (selectedIndex - 1 + assets.metadata.countyCount) % assets.metadata.countyCount;
    } else if (event.key === "Home") next = 0;
    else next = assets.metadata.countyCount - 1;
    onSelectedFips(assets.map.geometry.counties[next].fips);
    setHoveredIndex(null);
  };

  const activeWeek = assets.metadata.pulse[weekIndex];
  const detailCounty = detailGeometry ? countiesByFips.get(detailGeometry.fips) : undefined;
  return (
    <div className="mobility-figure-grid mobility-county-map-grid">
      <div className="mobility-canvas-shell">
        <canvas
          ref={canvasRef}
          className="mobility-county-map-canvas"
          role="img"
          tabIndex={0}
          aria-label={`Animated U.S. county map of net cross-county mobility for ${activeWeek ? formatWeek(activeWeek) : "the selected week"}. Blue means net inbound and red means net outbound. Hover, click, or use arrow keys to inspect counties.`}
          onPointerMove={handlePointer}
          onPointerLeave={() => setHoveredIndex(null)}
          onPointerDown={(event) => {
            const county = countyAtPointer(event, assets.map, paths);
            if (county !== null) onSelectedFips(assets.map.geometry.counties[county].fips);
          }}
          onKeyDown={handleKeyDown}
        >
          U.S. county map of weekly net cross-county mobility.
        </canvas>
        <div className="mobility-balance-legend" aria-label="Net mobility balance color legend">
          <span>Net outbound</span>
          <div aria-hidden="true">
            <i className="is-outbound-strong" /><i className="is-outbound-light" />
            <i className="is-balanced" />
            <i className="is-inbound-light" /><i className="is-inbound-strong" />
          </div>
          <span>Net inbound</span>
        </div>
      </div>
      <aside
        className="mobility-detail-panel"
        aria-live={!isPlaying && hoveredIndex === null ? "polite" : "off"}
      >
        <span className="mobility-detail-label">
          {hoveredIndex === null ? "Selected county" : "County under pointer"} · FIPS {detailGeometry?.fips}
        </span>
        <h4>{detailCounty?.county ?? detailGeometry?.name ?? "No county"}</h4>
        <p className="mobility-detail-state">{detailCounty?.state ?? detailGeometry?.state}</p>
        <dl>
          <div><dt>Inbound from other counties</dt><dd>{formatCompact(detailInbound)}</dd></div>
          <div><dt>Outbound to other counties</dt><dd>{formatCompact(detailOutbound)}</dd></div>
          <div><dt>Net balance</dt><dd>{formatSigned(detailBalance)}</dd></div>
        </dl>
        <small className="mobility-detail-note">
          Color uses a fixed signed-log scale across all 156 weeks. Gold outlines the county
          carried into the spotlight below.
        </small>
      </aside>
    </div>
  );
}

function CountyMobilitySpotlight({
  assets,
  counties,
  focusState,
  weekIndex,
  selectedFips,
  onFocusState,
  onSelectedFips,
  onWeekIndex,
}: {
  assets: MobilityDynamicsAssets;
  counties: MobilityStoryCounty[];
  focusState: string;
  weekIndex: number;
  selectedFips: string;
  onFocusState: (state: string) => void;
  onSelectedFips: (fips: string) => void;
  onWeekIndex: (index: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dimensions = useCanvasDimensions(canvasRef);
  const geometryIndex = useMemo(
    () => Math.max(0, assets.map.geometry.counties.findIndex((county) => county.fips === selectedFips)),
    [assets.map.geometry.counties, selectedFips],
  );
  const selectedCounty = counties.find((county) => county.fips === selectedFips) ?? counties[0];
  const stateNames = useMemo(
    () => [...new Set(counties.map((county) => county.state))].sort((a, b) => a.localeCompare(b)),
    [counties],
  );
  const countyOptions = useMemo(
    () => counties
      .filter((county) => focusState === ALL_STATES || county.state === focusState)
      .slice()
      .sort((a, b) => a.county.localeCompare(b.county)),
    [counties, focusState],
  );
  const weeklySeries = useMemo(() => {
    const inbound: number[] = [];
    const outbound: number[] = [];
    for (let index = 0; index < assets.metadata.weekCount; index += 1) {
      const offset = flowOffset(index, geometryIndex, assets.metadata.countyCount);
      inbound.push(assets.values[offset] ?? 0);
      outbound.push(assets.values[offset + 1] ?? 0);
    }
    return { inbound, outbound };
  }, [assets, geometryIndex]);
  const maximum = Math.max(1, ...weeklySeries.inbound, ...weeklySeries.outbound);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = prepareCanvas(canvas, dimensions);
    if (!context) return;
    const margin = { top: 24, right: 24, bottom: 42, left: 62 };
    const width = Math.max(1, dimensions.width - margin.left - margin.right);
    const height = Math.max(1, dimensions.height - margin.top - margin.bottom);
    const xFor = (index: number) => margin.left + (index / Math.max(1, assets.metadata.weekCount - 1)) * width;
    const yFor = (value: number) => margin.top + (1 - value / maximum) * height;

    context.fillStyle = PAPER;
    context.fillRect(0, 0, dimensions.width, dimensions.height);
    context.font = "9px SFMono-Regular, Consolas, monospace";
    context.textBaseline = "middle";
    context.textAlign = "right";
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = (tick / 4) * maximum;
      const y = yFor(value);
      context.strokeStyle = RULE;
      context.beginPath();
      context.moveTo(margin.left, y);
      context.lineTo(margin.left + width, y);
      context.stroke();
      context.fillStyle = INK_FAINT;
      context.fillText(formatCompact(value), margin.left - 8, y);
    }

    const drawLine = (values: number[], color: string) => {
      context.beginPath();
      values.forEach((value, index) => {
        const x = xFor(index);
        const y = yFor(value);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = color;
      context.lineWidth = 2.1;
      context.stroke();
    };
    drawLine(weeklySeries.inbound, BLUE);
    drawLine(weeklySeries.outbound, RED);

    const x = xFor(weekIndex);
    context.strokeStyle = "rgba(21, 25, 30, 0.55)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, margin.top);
    context.lineTo(x, margin.top + height);
    context.stroke();
    [
      { value: weeklySeries.inbound[weekIndex], color: BLUE },
      { value: weeklySeries.outbound[weekIndex], color: RED },
    ].forEach((point) => {
      context.beginPath();
      context.arc(x, yFor(point.value ?? 0), 4.7, 0, Math.PI * 2);
      context.fillStyle = point.color;
      context.fill();
      context.strokeStyle = PAPER;
      context.lineWidth = 1.5;
      context.stroke();
    });

    context.fillStyle = INK_FAINT;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(assets.metadata.pulse[0]?.weekStart.slice(0, 4) ?? "", margin.left, margin.top + height + 12);
    context.textAlign = "right";
    context.fillText(assets.metadata.pulse.at(-1)?.weekEnd.slice(0, 4) ?? "", margin.left + width, margin.top + height + 12);
  }, [assets.metadata, dimensions, maximum, weekIndex, weeklySeries]);

  const updateFromPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onWeekIndex(pointerIndex(event, canvas, assets.metadata.weekCount, 62, 24));
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onWeekIndex(Math.min(assets.metadata.weekCount - 1, weekIndex + 1));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onWeekIndex(Math.max(0, weekIndex - 1));
    }
  };

  const activeOffset = flowOffset(weekIndex, geometryIndex, assets.metadata.countyCount);
  const activeInbound = assets.values[activeOffset] ?? 0;
  const activeOutbound = assets.values[activeOffset + 1] ?? 0;
  return (
    <div className="mobility-spotlight">
      <div className="mobility-spotlight-controls">
        <label>
          <span>State</span>
          <select
            value={focusState}
            onChange={(event) => {
              const nextState = event.target.value;
              onFocusState(nextState);
              const nextCounty = counties.find((county) => nextState === ALL_STATES || county.state === nextState);
              if (nextCounty) onSelectedFips(nextCounty.fips);
            }}
          >
            <option>{ALL_STATES}</option>
            {stateNames.map((state) => <option key={state}>{state}</option>)}
          </select>
        </label>
        <label>
          <span>County</span>
          <select value={selectedFips} onChange={(event) => onSelectedFips(event.target.value)}>
            {countyOptions.map((county) => (
              <option key={county.fips} value={county.fips}>{county.county}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mobility-figure-grid">
        <div className="mobility-canvas-shell">
          <canvas
            ref={canvasRef}
            className="mobility-spotlight-canvas"
            role="img"
            tabIndex={0}
            aria-label={`Weekly cross-county inbound and outbound mobility for ${selectedCounty?.county}, ${selectedCounty?.state}. Click, drag, or use arrow keys to inspect weeks.`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              updateFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
            }}
            onKeyDown={handleKeyDown}
          >
            Weekly inbound and outbound observations for the selected county.
          </canvas>
          <div className="mobility-chart-key" aria-hidden="true">
            <span><i className="is-teal" />Inbound</span>
            <span><i className="is-red" />Outbound</span>
            <span><i className="is-dashed" />Selected week</span>
          </div>
        </div>
        <aside className="mobility-detail-panel" aria-live="polite">
          <span className="mobility-detail-label">County spotlight · FIPS {selectedCounty?.fips}</span>
          <h4>{selectedCounty?.county}</h4>
          <p className="mobility-detail-state">{selectedCounty?.state}</p>
          <dl>
            <div><dt>Selected-week inbound</dt><dd>{formatCompact(activeInbound)}</dd></div>
            <div><dt>Selected-week outbound</dt><dd>{formatCompact(activeOutbound)}</dd></div>
            <div><dt>Selected-week balance</dt><dd>{formatSigned(activeInbound - activeOutbound)}</dd></div>
            <div><dt>Full-archive cross-county activity</dt><dd>{formatCompact(selectedCounty?.total ?? 0)}</dd></div>
          </dl>
        </aside>
      </div>
    </div>
  );
}

interface LagPoint {
  weekIndex: number;
  mobility: number;
  incidence: number;
  mobilityWeek: string;
  incidenceWeek: string;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function pearson(points: LagPoint[]): number {
  if (points.length < 3) return 0;
  const meanX = points.reduce((sum, point) => sum + point.mobility, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.incidence, 0) / points.length;
  let numerator = 0;
  let xSquares = 0;
  let ySquares = 0;
  points.forEach((point) => {
    const x = point.mobility - meanX;
    const y = point.incidence - meanY;
    numerator += x * y;
    xSquares += x * x;
    ySquares += y * y;
  });
  return xSquares > 0 && ySquares > 0 ? numerator / Math.sqrt(xSquares * ySquares) : 0;
}

function MobilityIncidenceLagExplorer({
  pulse,
  covidSeries,
  covidMetric,
  lagWeeks,
  weekIndex,
  onLagWeeks,
  onWeekIndex,
}: {
  pulse: PulseRow[];
  covidSeries: MobilityCovidDatum[];
  covidMetric: CovidMetric;
  lagWeeks: number;
  weekIndex: number;
  onLagWeeks: (lag: number) => void;
  onWeekIndex: (index: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dimensions = useCanvasDimensions(canvasRef);
  const covidByDate = useMemo(
    () => new Map(covidSeries.map((row) => [row.date, row])),
    [covidSeries],
  );
  const points = useMemo(() => pulse.flatMap((row, index) => {
    const targetStart = addDays(row.weekStart, lagWeeks * 7);
    const dailyValues: number[] = [];
    for (let day = 0; day < 7; day += 1) {
      const datum = covidByDate.get(addDays(targetStart, day));
      if (!datum) return [];
      dailyValues.push(covidMetric === "cases" ? datum.casesAvgPer100k : datum.deathsAvgPer100k);
    }
    return [{
      weekIndex: index,
      mobility: row.crossCountyIndex,
      incidence: dailyValues.reduce((sum, value) => sum + value, 0) / dailyValues.length,
      mobilityWeek: row.weekStart,
      incidenceWeek: targetStart,
    }];
  }), [covidByDate, covidMetric, lagWeeks, pulse]);
  const correlation = pearson(points);
  const xMinimum = Math.max(0, Math.min(...points.map((point) => point.mobility), 100) * 0.92);
  const xMaximum = Math.max(110, Math.max(...points.map((point) => point.mobility), 100) * 1.06);
  const yMaximum = Math.max(1, Math.max(...points.map((point) => point.incidence)) * 1.08);

  const plotPoint = useCallback((point: LagPoint, width: number, height: number) => {
    const margin = { top: 26, right: 24, bottom: 50, left: 62 };
    return {
      x: margin.left + ((point.mobility - xMinimum) / Math.max(1, xMaximum - xMinimum)) * (width - margin.left - margin.right),
      y: margin.top + (1 - point.incidence / yMaximum) * (height - margin.top - margin.bottom),
      margin,
    };
  }, [xMaximum, xMinimum, yMaximum]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = prepareCanvas(canvas, dimensions);
    if (!context || points.length === 0) return;
    const sample = plotPoint(points[0], dimensions.width, dimensions.height);
    const { margin } = sample;
    const width = dimensions.width - margin.left - margin.right;
    const height = dimensions.height - margin.top - margin.bottom;
    context.fillStyle = PAPER;
    context.fillRect(0, 0, dimensions.width, dimensions.height);
    context.font = "9px SFMono-Regular, Consolas, monospace";
    context.textBaseline = "top";

    for (let tick = 0; tick <= 4; tick += 1) {
      const yValue = (tick / 4) * yMaximum;
      const y = margin.top + (1 - tick / 4) * height;
      context.strokeStyle = RULE;
      context.beginPath();
      context.moveTo(margin.left, y);
      context.lineTo(margin.left + width, y);
      context.stroke();
      context.fillStyle = INK_FAINT;
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(yValue.toFixed(yValue < 10 ? 1 : 0), margin.left - 8, y);
    }

    const baselineX = margin.left + ((100 - xMinimum) / Math.max(1, xMaximum - xMinimum)) * width;
    context.setLineDash([5, 5]);
    context.strokeStyle = "rgba(21, 25, 30, 0.5)";
    context.beginPath();
    context.moveTo(baselineX, margin.top);
    context.lineTo(baselineX, margin.top + height);
    context.stroke();
    context.setLineDash([]);

    const meanX = points.reduce((sum, point) => sum + point.mobility, 0) / points.length;
    const meanY = points.reduce((sum, point) => sum + point.incidence, 0) / points.length;
    const covariance = points.reduce(
      (sum, point) => sum + (point.mobility - meanX) * (point.incidence - meanY),
      0,
    );
    const varianceX = points.reduce((sum, point) => sum + (point.mobility - meanX) ** 2, 0);
    const slope = varianceX ? covariance / varianceX : 0;
    const intercept = meanY - slope * meanX;
    const regressionPoints = [
      { mobility: xMinimum, incidence: Math.max(0, intercept + slope * xMinimum) },
      { mobility: xMaximum, incidence: Math.max(0, intercept + slope * xMaximum) },
    ];
    context.strokeStyle = GOLD;
    context.lineWidth = 2;
    context.beginPath();
    regressionPoints.forEach((point, index) => {
      const x = margin.left + ((point.mobility - xMinimum) / Math.max(1, xMaximum - xMinimum)) * width;
      const y = margin.top + (1 - point.incidence / yMaximum) * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();

    points.forEach((point) => {
      const plotted = plotPoint(point, dimensions.width, dimensions.height);
      const selected = point.weekIndex === weekIndex;
      context.beginPath();
      context.arc(plotted.x, plotted.y, selected ? 6 : 3.3, 0, Math.PI * 2);
      context.fillStyle = selected ? RED : "rgba(0, 109, 119, 0.55)";
      context.fill();
      if (selected) {
        context.strokeStyle = PAPER;
        context.lineWidth = 1.5;
        context.stroke();
      }
    });

    context.fillStyle = INK;
    context.font = "700 10px Avenir Next, Helvetica Neue, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText("CROSS-COUNTY MOBILITY INDEX →", margin.left + width / 2, dimensions.height - 6);
    context.save();
    context.translate(13, margin.top + height / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(`${covidMetric.toUpperCase()} PER 100K →`, 0, 0);
    context.restore();
  }, [covidMetric, dimensions, points, plotPoint, weekIndex, xMaximum, xMinimum, yMaximum]);

  const selectNearest = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rectangle = canvas.getBoundingClientRect();
    const x = event.clientX - rectangle.left;
    const y = event.clientY - rectangle.top;
    let nearest: LagPoint | null = null;
    let distance = 18;
    points.forEach((point) => {
      const plotted = plotPoint(point, rectangle.width, rectangle.height);
      const candidate = Math.hypot(plotted.x - x, plotted.y - y);
      if (candidate < distance) {
        nearest = point;
        distance = candidate;
      }
    });
    if (nearest) onWeekIndex((nearest as LagPoint).weekIndex);
  };

  const selectedPoint = points.find((point) => point.weekIndex === weekIndex) ?? points.at(-1);
  return (
    <div className="mobility-lag-grid">
      <div className="mobility-canvas-shell">
        <div className="mobility-lag-control">
          <label>
            <span>Incidence lag</span>
            <input
              type="range"
              min={0}
              max={8}
              value={lagWeeks}
              onChange={(event) => onLagWeeks(Number(event.target.value))}
              aria-valuetext={`${lagWeeks} ${lagWeeks === 1 ? "week" : "weeks"}`}
            />
            <strong>{lagWeeks} {lagWeeks === 1 ? "week" : "weeks"}</strong>
          </label>
          <p>Mobility at week t is compared with incidence at week t + lag.</p>
        </div>
        <canvas
          ref={canvasRef}
          className="mobility-lag-canvas"
          role="img"
          tabIndex={0}
          aria-label={`Scatterplot comparing weekly cross-county mobility with national reported ${covidMetric} per 100,000 residents ${lagWeeks} weeks later. Click a point to select its mobility week.`}
          onPointerDown={selectNearest}
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            const current = Math.max(0, points.findIndex((point) => point.weekIndex === weekIndex));
            const direction = event.key === "ArrowRight" ? 1 : -1;
            const next = Math.max(0, Math.min(points.length - 1, current + direction));
            if (points[next]) onWeekIndex(points[next].weekIndex);
          }}
        >
          Weekly mobility-incidence lag scatterplot.
        </canvas>
        <div className="mobility-chart-key" aria-hidden="true">
          <span><i className="is-teal" />Observed weeks</span>
          <span><i className="is-gold" />Linear association</span>
          <span><i className="is-dashed" />2019 mobility baseline</span>
        </div>
      </div>
      <aside className="mobility-detail-panel" aria-live="polite">
        <span className="mobility-detail-label">Descriptive association</span>
        <h4>r = {correlation.toFixed(2)}</h4>
        <p className="mobility-detail-state">{points.length} complete weekly comparisons</p>
        <dl>
          <div><dt>Mobility index</dt><dd>{selectedPoint?.mobility.toFixed(1) ?? "—"}</dd></div>
          <div><dt>{covidMetric} per 100k</dt><dd>{selectedPoint?.incidence.toFixed(1) ?? "—"}</dd></div>
          <div><dt>Mobility week</dt><dd>{selectedPoint ? weekFormatter.format(new Date(`${selectedPoint.mobilityWeek}T00:00:00Z`)) : "—"}</dd></div>
          <div><dt>Incidence week</dt><dd>{selectedPoint ? weekFormatter.format(new Date(`${selectedPoint.incidenceWeek}T00:00:00Z`)) : "—"}</dd></div>
        </dl>
        <small className="mobility-detail-note">
          This is an unadjusted descriptive correlation. It does not estimate a causal effect of
          mobility on infection, and reporting conditions changed throughout the archive.
        </small>
      </aside>
    </div>
  );
}

export default function MobilityStory({
  counties,
  focusState,
  onFocusState,
  covidSeries,
  covidMetric,
  timelineHost,
}: MobilityStoryProps) {
  const firstFigureRef = useRef<HTMLElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [assets, setAssets] = useState<MobilityDynamicsAssets | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [weekIndex, setWeekIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedFips, setSelectedFips] = useState(counties[0]?.fips ?? "");
  const [lagWeeks, setLagWeeks] = useState(2);

  useEffect(() => {
    const loadTrigger = timelineHost ?? firstFigureRef.current;
    if (!loadTrigger || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(loadTrigger);
    return () => observer.disconnect();
  }, [timelineHost]);

  useEffect(() => {
    if (!shouldLoad) return;
    const controller = new AbortController();
    async function loadAssets() {
      try {
        const [metadataResponse, valuesResponse, mapResponse] = await Promise.all([
          fetch("/data/mobility-dynamics.json", { signal: controller.signal }),
          fetch("/data/mobility-weekly.bin", { signal: controller.signal }),
          fetch("/data/county-incidence-map.json", { signal: controller.signal }),
        ]);
        if (!metadataResponse.ok || !valuesResponse.ok || !mapResponse.ok) {
          throw new Error("The weekly mobility archive could not be reached.");
        }
        const [metadata, buffer, map] = await Promise.all([
          metadataResponse.json() as Promise<MobilityDynamicsMetadata>,
          valuesResponse.arrayBuffer(),
          mapResponse.json() as Promise<CountyMapMetadata>,
        ]);
        const binary = new Uint8Array(buffer);
        const header = Array.from(binary.subarray(0, metadata.binaryHeaderBytes))
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        const expectedValues = metadata.weekCount * metadata.countyCount * metadata.fieldCount;
        const values = new Uint32Array(buffer, metadata.binaryHeaderBytes);
        const countySet = new Set(counties.map((county) => county.fips));
        const mapMatchesCounties = map.geometry.counties.length === counties.length
          && map.geometry.counties.every((county) => countySet.has(county.fips));
        if (
          header !== metadata.buildId
          || buffer.byteLength !== metadata.binaryBytes
          || values.length !== expectedValues
          || metadata.fieldCount !== FLOW_FIELDS
          || metadata.countyCount !== map.countyCount
          || metadata.geometryBuildId !== map.buildId
          || !mapMatchesCounties
        ) {
          throw new Error("The weekly mobility archive did not match its county map index.");
        }
        setAssets({ metadata, values, map });
        setWeekIndex(metadata.weekCount - 1);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setLoadError(caught instanceof Error ? caught.message : "Weekly mobility data unavailable.");
      }
    }
    void loadAssets();
    return () => controller.abort();
  }, [counties, loadAttempt, shouldLoad]);

  useEffect(() => {
    if (!isPlaying || !assets) return;
    const interval = window.setInterval(() => {
      setWeekIndex((current) => (current + 1) % assets.metadata.weekCount);
    }, 650);
    return () => window.clearInterval(interval);
  }, [assets, isPlaying]);

  const paths = useMemo(() => assets ? createPathCache(assets.map) : null, [assets]);
  const countiesByFips = useMemo(
    () => new Map(counties.map((county) => [county.fips, county])),
    [counties],
  );
  const effectiveSelectedFips = useMemo(() => {
    const current = countiesByFips.get(selectedFips);
    if (focusState === ALL_STATES || current?.state === focusState) return selectedFips;
    return counties.find((county) => county.state === focusState)?.fips ?? selectedFips;
  }, [counties, countiesByFips, focusState, selectedFips]);
  const selectCounty = useCallback((fips: string) => {
    setSelectedFips(fips);
    const county = countiesByFips.get(fips);
    if (county && county.state !== focusState) onFocusState(county.state);
  }, [countiesByFips, focusState, onFocusState]);

  const timelinePortal = timelineHost
    ? createPortal(
      assets ? (
        <MobilityTimelineControls
          pulse={assets.metadata.pulse}
          weekIndex={weekIndex}
          isPlaying={isPlaying}
          onWeekIndex={setWeekIndex}
          onTogglePlayback={() => setIsPlaying((playing) => !playing)}
        />
      ) : (
        <div className="mobility-timeline-loading" role="status">
          {loadError || (shouldLoad ? "Preparing the weekly mobility timeline…" : "Weekly mobility timeline loads as this section approaches.")}
        </div>
      ),
      timelineHost,
    )
    : null;

  if (!assets || !paths) {
    return (
      <>
        {timelinePortal}
        <article className="mobility-figure mobility-dynamic-figure" ref={firstFigureRef}>
          <div className="mobility-figure-heading mobility-figure-heading-plain">
            <div>
              <h3>Animated County Flow Map</h3>
              <p>
                Weekly county movement is loading for the animated map.
              </p>
            </div>
          </div>
          <div className={`mobility-dynamics-status${loadError ? " is-error" : ""}`} role={loadError ? "alert" : "status"}>
            <span aria-hidden="true" />
            <p>{loadError || (shouldLoad ? "Preparing 156 weeks of county mobility…" : "Weekly mobility loads as this figure approaches.")}</p>
            {loadError ? (
              <button
                type="button"
                onClick={() => {
                  setLoadError("");
                  setLoadAttempt((attempt) => attempt + 1);
                }}
              >
                Try loading again
              </button>
            ) : null}
          </div>
        </article>
      </>
    );
  }

  const activeWeek = assets.metadata.pulse[weekIndex];
  return (
    <>
      {timelinePortal}
      <article className="mobility-figure mobility-dynamic-figure" ref={firstFigureRef}>
        <div className="mobility-figure-heading mobility-figure-heading-plain mobility-heading-with-date">
          <div>
            <h3>Animated County Flow Map</h3>
            <p>
              Net cross-county balance for every county. Blue indicates more inbound than
              outbound observations; red indicates the reverse. Play the weekly control above
              to watch the balance shift.
            </p>
          </div>
          <time dateTime={activeWeek?.weekStart}>{activeWeek ? formatWeek(activeWeek) : ""}</time>
        </div>
        <AnimatedCountyFlowMap
          assets={assets}
          paths={paths}
          countiesByFips={countiesByFips}
          weekIndex={weekIndex}
          selectedFips={effectiveSelectedFips}
          isPlaying={isPlaying}
          onSelectedFips={selectCounty}
        />
      </article>

      <article className="mobility-figure mobility-dynamic-figure">
        <div className="mobility-figure-heading mobility-figure-heading-plain">
          <div>
            <h3>County Mobility Spotlight</h3>
            <p>
              Follow weekly inbound and outbound cross-county observations for one county.
              Select on the map or use the state and county menus.
            </p>
          </div>
        </div>
        <CountyMobilitySpotlight
          assets={assets}
          counties={counties}
          focusState={focusState}
          weekIndex={weekIndex}
          selectedFips={effectiveSelectedFips}
          onFocusState={onFocusState}
          onSelectedFips={selectCounty}
          onWeekIndex={setWeekIndex}
        />
      </article>

      <article className="mobility-figure mobility-dynamic-figure">
        <div className="mobility-figure-heading mobility-figure-heading-plain">
          <div>
            <h3>Mobility–Incidence Lag Explorer</h3>
            <p>
              Compare the weekly cross-county mobility index at time t with national reported
              {` ${covidMetric}`} incidence 0–8 weeks later. The active cases/deaths metric at the
              top of the atlas controls this view.
            </p>
          </div>
        </div>
        <MobilityIncidenceLagExplorer
          pulse={assets.metadata.pulse}
          covidSeries={covidSeries}
          covidMetric={covidMetric}
          lagWeeks={lagWeeks}
          weekIndex={weekIndex}
          onLagWeeks={setLagWeeks}
          onWeekIndex={setWeekIndex}
        />
      </article>
    </>
  );
}
