"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import MobilityStory, { type MobilityCovidDatum } from "./MobilityStory";

interface MobilityMeta {
  source: string;
  sourceRepository: string;
  sourceFileCount: number;
  coverageStart: string;
  coverageEnd: string;
  grain: string;
  unit: string;
  metric: string;
  rowCount: number;
  validRowCount: number;
  countyCount: number;
  stateCount: number;
  totalObserved: number;
  intracountyObserved: number;
  intrastateCrossCountyObserved: number;
  interstateObserved: number;
}

interface MobilityQuality {
  malformedRows: number;
  negativeValueRows: number;
  zeroValueRows: number;
  excludedNonAtlasRows: number;
  duplicatePairsWithinSourceFile: number;
  dateRangeConflicts: number;
  sourceWeekGaps: number;
  duplicatePairsWithinOrigin: number;
  originBlockReentries: number;
  countyLabelConflicts: number;
  originCountyCount: number;
  destinationCountyCount: number;
}

interface MobilityState {
  state: string;
  interstateIn: number;
  interstateOut: number;
  interstateTotal: number;
  intrastateCrossCounty: number;
}

interface StatePair {
  source: string;
  target: string;
  value: number;
}

interface MobilityCounty {
  fips: string;
  state: string;
  county: string;
  inbound: number;
  outbound: number;
  total: number;
  balance: number;
}

interface MobilityData {
  meta: MobilityMeta;
  quality: MobilityQuality;
  states: MobilityState[];
  statePairs: StatePair[];
  counties: MobilityCounty[];
}

interface CanvasDimensions {
  width: number;
  height: number;
}

const ALL_STATES = "All states";
const INK = "#15191e";
const INK_FAINT = "#737575";
const RULE = "rgba(21, 25, 30, 0.18)";
const PAPER = "#fffdf7";
const TEAL = "#006d77";
const RED = "#a9363e";
const GOLD = "#8a5a00";

const STATE_ABBREVIATIONS: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
  Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
  Wyoming: "WY",
};

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatCompact(value: number): string {
  return compactFormatter.format(value);
}

function formatInteger(value: number): string {
  return integerFormatter.format(value);
}

function formatDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function useCanvasDimensions(ref: React.RefObject<HTMLCanvasElement | null>): CanvasDimensions {
  const [dimensions, setDimensions] = useState<CanvasDimensions>({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const update = () => {
      const rect = canvas.getBoundingClientRect();
      setDimensions({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
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

function wheelPositions(states: string[], dimensions: CanvasDimensions) {
  const { width, height } = dimensions;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(20, Math.min(width, height) * 0.39);
  return new Map(
    states.map((state, index) => {
      const angle = (index / states.length) * Math.PI * 2 - Math.PI / 2;
      return [
        state,
        {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
          angle,
        },
      ];
    }),
  );
}

function FlowWheel({
  pairs,
  states,
  stateRows,
  focusState,
  onFocusState,
}: {
  pairs: StatePair[];
  states: string[];
  stateRows: MobilityState[];
  focusState: string;
  onFocusState: (state: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dimensions = useCanvasDimensions(canvasRef);
  const [hoveredState, setHoveredState] = useState("");
  const activeState = hoveredState || (focusState === ALL_STATES ? "" : focusState);

  const visiblePairs = useMemo(() => {
    const selected = focusState === ALL_STATES
      ? []
      : pairs.filter((pair) => pair.source === focusState || pair.target === focusState).slice(0, 28);
    const merged = new Map<string, StatePair>();
    [...pairs.slice(0, 75), ...selected].forEach((pair) => {
      merged.set(`${pair.source}|${pair.target}`, pair);
    });
    return [...merged.values()].sort((a, b) => a.value - b.value);
  }, [focusState, pairs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = prepareCanvas(canvas, dimensions);
    if (!context) return;
    const positions = wheelPositions(states, dimensions);
    const maximum = Math.max(1, ...pairs.map((pair) => pair.value));

    context.fillStyle = PAPER;
    context.fillRect(0, 0, dimensions.width, dimensions.height);

    visiblePairs.forEach((pair) => {
      const source = positions.get(pair.source);
      const target = positions.get(pair.target);
      if (!source || !target) return;
      const isActive = Boolean(
        activeState && (pair.source === activeState || pair.target === activeState),
      );
      const strength = Math.sqrt(pair.value / maximum);
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.quadraticCurveTo(
        dimensions.width / 2,
        dimensions.height / 2,
        target.x,
        target.y,
      );
      context.strokeStyle = isActive
        ? `rgba(169, 54, 62, ${0.38 + strength * 0.55})`
        : `rgba(0, 109, 119, ${0.045 + strength * 0.2})`;
      context.lineWidth = isActive ? 1.2 + strength * 5.5 : 0.4 + strength * 2.5;
      context.stroke();
    });

    context.beginPath();
    context.arc(
      dimensions.width / 2,
      dimensions.height / 2,
      Math.max(20, Math.min(dimensions.width, dimensions.height) * 0.39),
      0,
      Math.PI * 2,
    );
    context.strokeStyle = RULE;
    context.lineWidth = 1;
    context.stroke();

    positions.forEach(({ x, y, angle }, state) => {
      const selected = state === activeState;
      context.beginPath();
      context.arc(x, y, selected ? 6 : 3.2, 0, Math.PI * 2);
      context.fillStyle = selected ? RED : TEAL;
      context.fill();

      const labelRadius = selected ? 20 : 15;
      const labelX = x + Math.cos(angle) * labelRadius;
      const labelY = y + Math.sin(angle) * labelRadius;
      context.fillStyle = selected ? RED : INK_FAINT;
      context.font = selected
        ? "700 11px SFMono-Regular, Consolas, monospace"
        : "600 9px SFMono-Regular, Consolas, monospace";
      context.textAlign = Math.cos(angle) > 0.15 ? "left" : Math.cos(angle) < -0.15 ? "right" : "center";
      context.textBaseline = Math.sin(angle) > 0.15 ? "top" : Math.sin(angle) < -0.15 ? "bottom" : "middle";
      context.fillText(STATE_ABBREVIATIONS[state] ?? state.slice(0, 2), labelX, labelY);
    });
  }, [activeState, dimensions, pairs, states, visiblePairs]);

  const stateAtPointer = (event: { clientX: number; clientY: number }): string => {
    const canvas = canvasRef.current;
    if (!canvas) return "";
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const positions = wheelPositions(states, { width: rect.width, height: rect.height });
    let nearest = "";
    let distance = 22;
    positions.forEach((point, state) => {
      const candidate = Math.hypot(point.x - x, point.y - y);
      if (candidate < distance) {
        nearest = state;
        distance = candidate;
      }
    });
    return nearest;
  };

  const moveFocus = (direction: number) => {
    const current = focusState === ALL_STATES ? -1 : states.indexOf(focusState);
    const next = (current + direction + states.length) % states.length;
    onFocusState(states[next]);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Home" || event.key === "Escape") {
      event.preventDefault();
      onFocusState(ALL_STATES);
    }
  };

  const detailState = activeState
    ? stateRows.find((row) => row.state === activeState)
    : stateRows.slice().sort((a, b) => b.interstateTotal - a.interstateTotal)[0];
  const detailName = detailState?.state ?? states[0];
  const topConnections = pairs
    .filter((pair) => pair.source === detailName || pair.target === detailName)
    .slice(0, 5);

  return (
    <div className="mobility-figure-grid">
      <div className="mobility-canvas-shell">
        <canvas
          ref={canvasRef}
          className="flow-wheel-canvas"
          role="img"
          tabIndex={0}
          aria-label="Interactive interstate mobility wheel. Hover or select a state; use arrow keys to move between states and Escape to reset."
          onPointerMove={(event) => setHoveredState(stateAtPointer(event))}
          onPointerLeave={() => setHoveredState("")}
          onClick={(event) => {
            const state = stateAtPointer(event);
            if (state) onFocusState(state);
          }}
          onKeyDown={handleKeyDown}
        />
        <div className="mobility-chart-key" aria-hidden="true">
          <span><i className="is-teal" />Leading interstate ties</span>
          <span><i className="is-red" />Focused state</span>
        </div>
      </div>
      <aside className="mobility-detail-panel" aria-live="polite">
        <span className="mobility-detail-label">State focus</span>
        <h4>{detailName}</h4>
        <dl>
          <div><dt>Interstate inbound</dt><dd>{formatCompact(detailState?.interstateIn ?? 0)}</dd></div>
          <div><dt>Interstate outbound</dt><dd>{formatCompact(detailState?.interstateOut ?? 0)}</dd></div>
          <div><dt>Cross-county, within state</dt><dd>{formatCompact(detailState?.intrastateCrossCounty ?? 0)}</dd></div>
        </dl>
        <p className="mobility-list-label">Largest two-way interstate ties</p>
        <ol className="mobility-flow-list">
          {topConnections.map((pair) => {
            const other = pair.source === detailName ? pair.target : pair.source;
            return (
              <li key={`${pair.source}-${pair.target}`}>
                <button type="button" onClick={() => onFocusState(other)}>
                  <span>{other}</span><strong>{formatCompact(pair.value)}</strong>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}

function CountyBalance({
  counties,
  focusState,
}: {
  counties: MobilityCounty[];
  focusState: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dimensions = useCanvasDimensions(canvasRef);
  const filteredCounties = useMemo(
    () => focusState === ALL_STATES ? counties : counties.filter((county) => county.state === focusState),
    [counties, focusState],
  );
  const [selectedFips, setSelectedFips] = useState(counties[0]?.fips ?? "");
  const [hoveredFips, setHoveredFips] = useState("");
  const effectiveSelectedFips = filteredCounties.some((county) => county.fips === selectedFips)
    ? selectedFips
    : (filteredCounties[0]?.fips ?? "");
  const activeFips = hoveredFips || effectiveSelectedFips;

  const domainMaximum = useMemo(
    () => Math.max(1, ...counties.map((county) => Math.max(county.inbound, county.outbound))),
    [counties],
  );

  const pointForCounty = useCallback((
    county: MobilityCounty,
    width: number,
    height: number,
  ) => {
    const margin = {
      top: 24,
      right: Math.max(18, width * 0.035),
      bottom: 54,
      left: Math.max(62, width * 0.075),
    };
    const plotWidth = Math.max(1, width - margin.left - margin.right);
    const plotHeight = Math.max(1, height - margin.top - margin.bottom);
    const maximum = Math.log10(domainMaximum + 1);
    return {
      x: margin.left + (Math.log10(county.outbound + 1) / maximum) * plotWidth,
      y: margin.top + (1 - Math.log10(county.inbound + 1) / maximum) * plotHeight,
      radius: 2 + Math.sqrt(county.total / Math.max(1, counties[0]?.total ?? 1)) * 5.5,
      margin,
      plotWidth,
      plotHeight,
    };
  }, [counties, domainMaximum]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = prepareCanvas(canvas, dimensions);
    if (!context) return;
    const sample = pointForCounty(filteredCounties[0] ?? counties[0], dimensions.width, dimensions.height);
    const { margin, plotWidth, plotHeight } = sample;
    const maximumLog = Math.log10(domainMaximum + 1);

    context.fillStyle = PAPER;
    context.fillRect(0, 0, dimensions.width, dimensions.height);
    const tickValues = [1_000, 10_000, 100_000, 1_000_000, 10_000_000].filter(
      (value) => value <= domainMaximum,
    );
    context.font = "9px SFMono-Regular, Consolas, monospace";
    context.textBaseline = "middle";
    tickValues.forEach((value) => {
      const progress = Math.log10(value + 1) / maximumLog;
      const x = margin.left + progress * plotWidth;
      const y = margin.top + (1 - progress) * plotHeight;
      context.strokeStyle = RULE;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, margin.top);
      context.lineTo(x, margin.top + plotHeight);
      context.stroke();
      context.beginPath();
      context.moveTo(margin.left, y);
      context.lineTo(margin.left + plotWidth, y);
      context.stroke();
      context.fillStyle = INK_FAINT;
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(formatCompact(value), x, margin.top + plotHeight + 8);
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(formatCompact(value), margin.left - 8, y);
    });

    context.strokeStyle = "rgba(21, 25, 30, 0.5)";
    context.setLineDash([5, 5]);
    context.beginPath();
    context.moveTo(margin.left, margin.top + plotHeight);
    context.lineTo(margin.left + plotWidth, margin.top);
    context.stroke();
    context.setLineDash([]);

    filteredCounties.slice().sort((a, b) => a.total - b.total).forEach((county) => {
      const point = pointForCounty(county, dimensions.width, dimensions.height);
      const balanceShare = county.total ? county.balance / county.total : 0;
      context.beginPath();
      context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.fillStyle = balanceShare > 0.05
        ? "rgba(0, 109, 119, 0.55)"
        : balanceShare < -0.05
          ? "rgba(169, 54, 62, 0.52)"
          : "rgba(82, 86, 90, 0.35)";
      context.fill();
    });

    const active = filteredCounties.find((county) => county.fips === activeFips);
    if (active) {
      const point = pointForCounty(active, dimensions.width, dimensions.height);
      context.beginPath();
      context.arc(point.x, point.y, point.radius + 5, 0, Math.PI * 2);
      context.strokeStyle = GOLD;
      context.lineWidth = 3;
      context.stroke();
    }

    context.fillStyle = INK;
    context.font = "700 10px Avenir Next, Helvetica Neue, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText("OUTBOUND TO OTHER COUNTIES →", margin.left + plotWidth / 2, dimensions.height - 5);
    context.save();
    context.translate(12, margin.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText("INBOUND FROM OTHER COUNTIES →", 0, 0);
    context.restore();
  }, [activeFips, counties, dimensions, domainMaximum, filteredCounties, pointForCounty]);

  const countyAtPointer = (event: { clientX: number; clientY: number }): string => {
    const canvas = canvasRef.current;
    if (!canvas) return "";
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let nearest = "";
    let distance = 13;
    filteredCounties.forEach((county) => {
      const point = pointForCounty(county, rect.width, rect.height);
      const candidate = Math.hypot(point.x - x, point.y - y);
      if (candidate < distance) {
        nearest = county.fips;
        distance = candidate;
      }
    });
    return nearest;
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const current = Math.max(
      0,
      filteredCounties.findIndex((county) => county.fips === effectiveSelectedFips),
    );
    const next = (current + direction + filteredCounties.length) % filteredCounties.length;
    setSelectedFips(filteredCounties[next]?.fips ?? "");
  };

  const detail = filteredCounties.find((county) => county.fips === activeFips)
    ?? filteredCounties[0];

  return (
    <div className="mobility-figure-grid">
      <div className="mobility-canvas-shell">
        <canvas
          ref={canvasRef}
          className="county-balance-canvas"
          role="img"
          tabIndex={0}
          aria-label={`Interactive county inbound versus outbound mobility plot for ${focusState}. Hover or select a county; use arrow keys to move through counties.`}
          onPointerMove={(event) => setHoveredFips(countyAtPointer(event))}
          onPointerLeave={() => setHoveredFips("")}
          onClick={(event) => {
            const fips = countyAtPointer(event);
            if (fips) setSelectedFips(fips);
          }}
          onKeyDown={handleKeyDown}
        />
        <div className="mobility-chart-key" aria-hidden="true">
          <span><i className="is-teal" />Net inbound</span>
          <span><i className="is-gray" />Near balance</span>
          <span><i className="is-red" />Net outbound</span>
          <span><i className="is-dashed" />Inbound = outbound</span>
        </div>
      </div>
      <aside className="mobility-detail-panel" aria-live="polite">
        <span className="mobility-detail-label">County focus · FIPS {detail?.fips}</span>
        <h4>{detail?.county ?? "No county"}</h4>
        <p className="mobility-detail-state">{detail?.state}</p>
        <dl>
          <div><dt>Inbound</dt><dd>{formatCompact(detail?.inbound ?? 0)}</dd></div>
          <div><dt>Outbound</dt><dd>{formatCompact(detail?.outbound ?? 0)}</dd></div>
          <div>
            <dt>Net balance</dt>
            <dd>{detail && detail.balance > 0 ? "+" : ""}{formatCompact(detail?.balance ?? 0)}</dd>
          </div>
        </dl>
        <p className="mobility-list-label">Highest cross-county activity</p>
        <ol className="mobility-flow-list">
          {filteredCounties.slice(0, 5).map((county) => (
            <li key={county.fips}>
              <button type="button" onClick={() => setSelectedFips(county.fips)}>
                <span>{county.county}</span><strong>{formatCompact(county.total)}</strong>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

export default function MobilityAtlas({
  covidSeries,
  covidMetric,
}: {
  covidSeries: MobilityCovidDatum[];
  covidMetric: "cases" | "deaths";
}) {
  const [data, setData] = useState<MobilityData | null>(null);
  const [error, setError] = useState("");
  const [focusState, setFocusState] = useState(ALL_STATES);
  const [timelineHost, setTimelineHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/mobility.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Mobility data request failed (${response.status})`);
        return response.json() as Promise<MobilityData>;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Mobility data unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stateNames = useMemo(
    () => data?.states.map((row) => row.state).sort((a, b) => a.localeCompare(b)) ?? [],
    [data],
  );

  if (!data) {
    return (
      <section className="atlas-section mobility-section" id="mobility">
        <div className="section-heading mobility-section-heading">
          <div className="section-heading-copy">
            <h2>Human Mobility Patterns</h2>
            <p>{error || "Preparing 90 million county-to-county mobility records…"}</p>
          </div>
        </div>
      </section>
    );
  }

  const crossCounty = data.meta.intrastateCrossCountyObserved + data.meta.interstateObserved;
  const cleanChecks =
    data.quality.malformedRows
    + data.quality.negativeValueRows
    + data.quality.duplicatePairsWithinSourceFile
    + data.quality.dateRangeConflicts
    + data.quality.sourceWeekGaps
    + data.quality.duplicatePairsWithinOrigin
    + data.quality.originBlockReentries
    + data.quality.countyLabelConflicts;

  return (
    <section className="atlas-section mobility-section" id="mobility">
      <div className="section-heading mobility-section-heading">
        <div className="section-heading-copy">
          <h2>Human Mobility Patterns</h2>
          <p>
            We define human mobility to mean the origin-to-destination movement inferred from
            anonymous cellphone-location visits, thereby accounting for all modes of
            transportation. Data represent ~10% of the U.S. population.
          </p>
        </div>
      </div>

      <div className="mobility-ledger">
        <div>
          <span>Coverage in this atlas</span>
          <strong>{formatDate(data.meta.coverageStart)}—{formatDate(data.meta.coverageEnd)}</strong>
        </div>
        <div>
          <span>Traveler observations*</span>
          <strong>{formatCompact(data.meta.totalObserved)}</strong>
        </div>
        <div>
          <span>Cross-county observations</span>
          <strong>{formatCompact(crossCounty)}</strong>
        </div>
        <div>
          <span>Counties represented</span>
          <strong>{formatInteger(data.meta.countyCount)}</strong>
        </div>
      </div>

      <article className="mobility-figure">
        <div className="mobility-figure-heading mobility-figure-heading-plain">
          <div>
            <h3>Where state borders were most porous</h3>
            <p>
              The 75 largest two-way interstate ties are shown. Focus a state to reveal its
              strongest links; line weight represents cumulative traveler observations.
            </p>
          </div>
        </div>
        <FlowWheel
          pairs={data.statePairs}
          states={stateNames}
          stateRows={data.states}
          focusState={focusState}
          onFocusState={setFocusState}
        />
      </article>

      <article className="mobility-figure">
        <div className="mobility-figure-heading mobility-figure-heading-plain">
          <div>
            <h3>Which counties pulled travel in—or pushed it out</h3>
            <p>
              Each circle is a county. Position compares inbound and outbound observations;
              size represents their combined volume. Within-county observations are excluded.
            </p>
          </div>
        </div>
        <CountyBalance counties={data.counties} focusState={focusState} />
      </article>

      <div className="mobility-control-desk" role="group" aria-label="Mobility explorer controls">
        <div className="mobility-control-row">
          <label htmlFor="mobility-state-focus">
            <span>State focus</span>
            <select
              id="mobility-state-focus"
              value={focusState}
              onChange={(event) => setFocusState(event.target.value)}
            >
              <option>{ALL_STATES}</option>
              {stateNames.map((state) => <option key={state}>{state}</option>)}
            </select>
          </label>
          <p>Click a state in the wheel to coordinate both views.</p>
          {focusState !== ALL_STATES && (
            <button type="button" onClick={() => setFocusState(ALL_STATES)}>Reset focus</button>
          )}
        </div>
        <div className="mobility-timeline-slot" ref={setTimelineHost} />
      </div>

      <MobilityStory
        counties={data.counties}
        focusState={focusState}
        onFocusState={setFocusState}
        covidSeries={covidSeries}
        covidMetric={covidMetric}
        timelineHost={timelineHost}
      />

      <div className="mobility-source-note">
        <p>
          *These figures use detected visitor flows rather than population-inferred estimates.
          Counts are movement observations, not unique individuals. The first two figures
          aggregate all {formatInteger(data.meta.sourceFileCount)} published weekly county files;
          the three figures below them retain the weekly sequence from those same files.
        </p>
        <p>
          Kang’s daily county release ends Apr. 15, 2021, but its weekly county release continues
          through Jan. 2, 2022. This atlas uses the complete weekly archive for the 50 states and
          D.C. · {formatInteger(data.meta.validRowCount)} valid origin-destination records ·
          {" "}{formatInteger(data.quality.excludedNonAtlasRows)} records involving other U.S.
          jurisdictions excluded ·
          {" "}{cleanChecks === 0 ? "No structural issues found" : `${cleanChecks} structural issues flagged`}
        </p>
      </div>
    </section>
  );
}
