"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Metric = "cases" | "deaths";
type Scale = "average" | "perCapita";

interface CountyGeometry {
  fips: string;
  name: string;
  state: string;
  path: string;
}

interface CountyField {
  name: string;
  cap: number;
  capQuantile: number;
  encoding: string;
}

interface CountyMetadata {
  version: number;
  buildId: string;
  binaryHeaderBytes: number;
  binaryBytes: number;
  coverageStart: string;
  coverageEnd: string;
  dayCount: number;
  countyCount: number;
  fields: CountyField[];
  missingValue: number;
  maximumEncodedValue: number;
  geometry: {
    width: number;
    height: number;
    counties: CountyGeometry[];
    stateBordersPath: string;
    nationPath: string;
  };
  reportingGroups: Record<string, string>;
}

interface CountyAssets {
  metadata: CountyMetadata;
  values: Uint8Array;
}

interface CountyPathCache {
  counties: Path2D[];
  countyOutlines: Path2D;
  stateBorders: Path2D;
  nation: Path2D;
  picker: HTMLCanvasElement;
}

interface CountyCenter {
  x: number;
  y: number;
  region: "contiguous" | "alaska" | "hawaii";
}

type CountyArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

interface CountyIncidenceMapProps {
  selectedDate: string;
  metric: Metric;
  scale: Scale;
  isPlaying: boolean;
}

const DAY_MS = 86_400_000;
const FIELD_COUNT = 4;
const COUNTY_COLORS = [
  "#eef5f7",
  "#d6e8ee",
  "#b9d9e4",
  "#8fc3d4",
  "#5da7c0",
  "#3187a7",
  "#126785",
  "#064764",
  "#022b48",
] as const;
const MISSING_COLOR = "#d8d5cc";

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function asDate(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function formatDate(date: string): string {
  return fullDateFormatter.format(asDate(date));
}

function fieldIndex(metric: Metric, scale: Scale): number {
  if (metric === "cases") return scale === "average" ? 0 : 1;
  return scale === "average" ? 2 : 3;
}

function dateIndex(date: string, start: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS,
  );
}

function decodeValue(encoded: number, cap: number, maximum: number): number {
  if (encoded <= 0) return 0;
  const encodedPosition = encoded === maximum ? maximum - 0.5 : encoded;
  return Math.expm1((encodedPosition / maximum) * Math.log1p(cap));
}

function formatValue(value: number, scale: Scale): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: scale === "perCapita" ? (value < 10 ? 2 : 1) : value < 100 ? 1 : 0,
  });
}

function fillForValue(encoded: number, missing: number, maximum: number): string {
  if (encoded === missing) return MISSING_COLOR;
  if (encoded === 0) return COUNTY_COLORS[0];
  const index = Math.max(
    1,
    Math.min(COUNTY_COLORS.length - 1, Math.ceil((encoded / maximum) * (COUNTY_COLORS.length - 1))),
  );
  return COUNTY_COLORS[index];
}

function createPathCache(metadata: CountyMetadata): CountyPathCache | null {
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
      const red = code & 255;
      const green = (code >> 8) & 255;
      const blue = (code >> 16) & 255;
      context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      context.fill(path);
    });
  }

  return { counties, countyOutlines, stateBorders, nation, picker };
}

function countyAtPointer(
  event: ReactPointerEvent<HTMLCanvasElement>,
  metadata: CountyMetadata,
  paths: CountyPathCache,
): number | null {
  const rectangle = event.currentTarget.getBoundingClientRect();
  if (rectangle.width <= 0 || rectangle.height <= 0) return null;
  const mapX = Math.max(
    0,
    Math.min(metadata.geometry.width - 1, ((event.clientX - rectangle.left) / rectangle.width) * metadata.geometry.width),
  );
  const mapY = Math.max(
    0,
    Math.min(metadata.geometry.height - 1, ((event.clientY - rectangle.top) / rectangle.height) * metadata.geometry.height),
  );
  const context = paths.picker.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const pixelX = Math.floor(mapX);
  const pixelY = Math.floor(mapY);
  const offsets = [
    [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ] as const;
  const checked = new Set<number>();

  for (const [offsetX, offsetY] of offsets) {
    const x = Math.max(0, Math.min(metadata.geometry.width - 1, pixelX + offsetX));
    const y = Math.max(0, Math.min(metadata.geometry.height - 1, pixelY + offsetY));
    const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
    const candidateIndex = red + (green << 8) + (blue << 16) - 1;
    if (
      candidateIndex < 0
      || candidateIndex >= metadata.countyCount
      || checked.has(candidateIndex)
    ) continue;
    checked.add(candidateIndex);
    if (context.isPointInPath(paths.counties[candidateIndex], mapX, mapY)) {
      return candidateIndex;
    }
  }
  return null;
}

function countyRegion(state: string): CountyCenter["region"] {
  if (state === "Alaska") return "alaska";
  if (state === "Hawaii") return "hawaii";
  return "contiguous";
}

function countyCenter(path: string, state: string): CountyCenter {
  const rings = path.match(/M[^M]+/g) ?? [];
  let totalArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  rings.forEach((ring) => {
    const coordinates = (ring.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const points: CountyCenter[] = [];
    for (let index = 0; index + 1 < coordinates.length; index += 2) {
      const x = coordinates[index];
      const y = coordinates[index + 1];
      if (x === undefined || y === undefined) continue;
      points.push({ x, y });
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
    if (points.length < 3) return;

    let twiceArea = 0;
    let centroidXNumerator = 0;
    let centroidYNumerator = 0;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
      const from = points[previous];
      const to = points[index];
      if (!from || !to) continue;
      const cross = (from.x * to.y) - (to.x * from.y);
      twiceArea += cross;
      centroidXNumerator += (from.x + to.x) * cross;
      centroidYNumerator += (from.y + to.y) * cross;
    }
    if (Math.abs(twiceArea) <= Number.EPSILON) return;
    totalArea += twiceArea / 2;
    weightedX += centroidXNumerator / 6;
    weightedY += centroidYNumerator / 6;
  });

  if (Math.abs(totalArea) > Number.EPSILON) {
    return { x: weightedX / totalArea, y: weightedY / totalArea, region: countyRegion(state) };
  }
  if ([minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) {
    return {
      x: (minimumX + maximumX) / 2,
      y: (minimumY + maximumY) / 2,
      region: countyRegion(state),
    };
  }
  return { x: 0, y: 0, region: countyRegion(state) };
}

function isCountyArrowKey(key: string): key is CountyArrowKey {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
}

function spatialCountyIndex(
  centers: CountyCenter[],
  currentIndex: number,
  key: CountyArrowKey,
): number {
  const origin = centers[currentIndex];
  if (!origin) return currentIndex;
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  let bestIndex = currentIndex;
  let bestScore = Number.POSITIVE_INFINITY;

  centers.forEach((candidate, index) => {
    if (index === currentIndex || candidate.region !== origin.region) return;
    const deltaX = candidate.x - origin.x;
    const deltaY = candidate.y - origin.y;
    const forward = key === "ArrowRight"
      ? deltaX
      : key === "ArrowLeft"
        ? -deltaX
        : key === "ArrowDown"
          ? deltaY
          : -deltaY;
    if (forward <= 0.25) return;
    const perpendicular = horizontal ? Math.abs(deltaY) : Math.abs(deltaX);
    if (perpendicular > forward) return;
    const distance = Math.hypot(deltaX, deltaY);
    const score = distance + 2 * perpendicular;
    if (score >= bestScore) return;
    bestScore = score;
    bestIndex = index;
  });

  return bestIndex;
}

export default function CountyIncidenceMap({
  selectedDate,
  metric,
  scale,
  isPlaying,
}: CountyIncidenceMapProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [assets, setAssets] = useState<CountyAssets | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [hoveredCounty, setHoveredCounty] = useState<number | null>(null);
  const [selectedCounty, setSelectedCounty] = useState<number | null>(null);
  const [pointerInsideMap, setPointerInsideMap] = useState(false);
  const [resizeVersion, setResizeVersion] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad) return;
    const controller = new AbortController();

    async function loadCountyAssets() {
      try {
        const [metadataResponse, valuesResponse] = await Promise.all([
          fetch("/data/county-incidence-map.json", { signal: controller.signal }),
          fetch("/data/county-incidence.bin", { signal: controller.signal }),
        ]);
        if (!metadataResponse.ok || !valuesResponse.ok) {
          throw new Error("The county archive could not be reached.");
        }
        const [metadata, buffer] = await Promise.all([
          metadataResponse.json() as Promise<CountyMetadata>,
          valuesResponse.arrayBuffer(),
        ]);
        const binary = new Uint8Array(buffer);
        const expectedBytes = metadata.dayCount * metadata.countyCount * FIELD_COUNT;
        const header = Array.from(binary.subarray(0, metadata.binaryHeaderBytes))
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        const values = binary.subarray(metadata.binaryHeaderBytes);
        if (
          metadata.geometry.counties.length !== metadata.countyCount
          || binary.byteLength !== metadata.binaryBytes
          || values.byteLength !== expectedBytes
          || header !== metadata.buildId
        ) {
          throw new Error("The county archive did not match its map index.");
        }
        setAssets({ metadata, values });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setLoadError(caught instanceof Error ? caught.message : "The county archive could not be loaded.");
      }
    }

    void loadCountyAssets();
    return () => controller.abort();
  }, [loadAttempt, shouldLoad]);

  const paths = useMemo(
    () => (assets ? createPathCache(assets.metadata) : null),
    [assets],
  );
  const countyCenters = useMemo(
    () => assets
      ? assets.metadata.geometry.counties.map((county) => countyCenter(county.path, county.state))
      : [],
    [assets],
  );

  const activeField = fieldIndex(metric, scale);
  const activeDay = assets
    ? Math.max(0, Math.min(assets.metadata.dayCount - 1, dateIndex(selectedDate, assets.metadata.coverageStart)))
    : 0;
  const valueOffset = assets
    ? (activeDay * assets.metadata.countyCount * FIELD_COUNT) + activeField
    : 0;

  const dailyHighCounty = useMemo(() => {
    if (!assets) return null;
    let highestIndex = 0;
    let highestValue = -1;
    for (let index = 0; index < assets.metadata.countyCount; index += 1) {
      const encoded = assets.values[valueOffset + index * FIELD_COUNT];
      if (encoded !== assets.metadata.missingValue && encoded > highestValue) {
        highestValue = encoded;
        highestIndex = index;
      }
    }
    return highestValue > 0 ? highestIndex : null;
  }, [assets, valueOffset]);

  const detailCountyIndex = pointerInsideMap
    ? hoveredCounty
    : selectedCounty ?? dailyHighCounty;
  const detailCounty = assets && detailCountyIndex !== null
    ? assets.metadata.geometry.counties[detailCountyIndex]
    : null;
  const detailEncoded = assets && detailCountyIndex !== null
    ? assets.values[valueOffset + detailCountyIndex * FIELD_COUNT]
    : assets?.metadata.missingValue ?? 255;
  const detailValue = assets && detailEncoded !== assets.metadata.missingValue
    ? decodeValue(
        detailEncoded,
        assets.metadata.fields[activeField]?.cap ?? 1,
        assets.metadata.maximumEncodedValue,
      )
    : null;
  const reportingGroup = detailCounty && assets
    ? assets.metadata.reportingGroups[detailCounty.fips]
    : undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assets || !paths) return;
    const observer = new ResizeObserver(() => setResizeVersion((version) => version + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [assets, paths]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assets || !paths) return;
    const rectangle = canvas.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const outputWidth = Math.max(1, Math.round(rectangle.width * ratio));
    const outputHeight = Math.max(1, Math.round(rectangle.height * ratio));
    if (canvas.width !== outputWidth) canvas.width = outputWidth;
    if (canvas.height !== outputHeight) canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, outputWidth, outputHeight);
    context.setTransform(
      (outputWidth / assets.metadata.geometry.width),
      0,
      0,
      (outputHeight / assets.metadata.geometry.height),
      0,
      0,
    );
    context.fillStyle = "#fffdf7";
    context.fillRect(0, 0, assets.metadata.geometry.width, assets.metadata.geometry.height);

    paths.counties.forEach((path, index) => {
      const encoded = assets.values[valueOffset + index * FIELD_COUNT];
      context.fillStyle = fillForValue(
        encoded,
        assets.metadata.missingValue,
        assets.metadata.maximumEncodedValue,
      );
      context.fill(path);
    });

    context.strokeStyle = "rgba(21, 25, 30, 0.25)";
    context.lineWidth = 0.35;
    context.stroke(paths.countyOutlines);
    context.strokeStyle = "rgba(21, 25, 30, 0.66)";
    context.lineWidth = 1.1;
    context.stroke(paths.stateBorders);
    context.strokeStyle = "#15191e";
    context.lineWidth = 1.5;
    context.stroke(paths.nation);

    if (detailCountyIndex !== null) {
      context.strokeStyle = "#a9363e";
      context.lineWidth = 2.6;
      context.stroke(paths.counties[detailCountyIndex]);
    }
  }, [activeField, assets, detailCountyIndex, paths, resizeVersion, valueOffset]);

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!assets || !paths) return;
    const county = countyAtPointer(event, assets.metadata, paths);
    setPointerInsideMap(true);
    setHoveredCounty((current) => current === county ? current : county);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!assets || !paths) return;
    const county = countyAtPointer(event, assets.metadata, paths);
    if (event.pointerType !== "mouse" && county !== null) setSelectedCounty(county);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>) {
    if (!assets) return;
    const current = selectedCounty ?? dailyHighCounty ?? 0;
    let next = current;
    if (isCountyArrowKey(event.key)) next = spatialCountyIndex(countyCenters, current, event.key);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = assets.metadata.countyCount - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      setPointerInsideMap(false);
      setHoveredCounty(null);
      setSelectedCounty(null);
      return;
    } else return;
    event.preventDefault();
    setPointerInsideMap(false);
    setHoveredCounty(null);
    setSelectedCounty(next);
  }

  const noun = metric === "cases" ? "cases" : "deaths";
  const unit = scale === "perCapita"
    ? `reported ${noun} per 100,000 residents per day, seven-day average`
    : `reported ${noun} per day, seven-day average`;
  const detailStatus = pointerInsideMap
    ? hoveredCounty !== null ? "County under pointer" : "No county under pointer"
    : selectedCounty !== null
      ? "Selected county"
      : dailyHighCounty !== null
        ? "Highest color band on this date"
        : `No reported ${noun} on this date`;

  return (
    <div className="county-incidence" ref={sectionRef} aria-busy={shouldLoad && !assets && !loadError}>
      <div className="county-incidence-heading">
        <div>
          <h2>Countywide Incidence</h2>
          <p>
            County-level {unit}. Darker blue indicates higher incidence on a fixed scale across
            the full archive, so color remains comparable as the date animation plays.
          </p>
        </div>
        <time dateTime={selectedDate}>{formatDate(selectedDate)}</time>
      </div>

      {!shouldLoad || (!assets && !loadError) ? (
        <div className="county-map-status" role="status">
          <span aria-hidden="true" />
          Preparing 3,142 county histories…
        </div>
      ) : null}

      {loadError ? (
        <div className="county-map-status is-error" role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoadError("");
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            Try loading again
          </button>
        </div>
      ) : null}

      {assets && paths ? (
        <div className="county-map-frame">
          <div className="county-map-visual">
            <canvas
              ref={canvasRef}
              className="county-map-canvas"
              role="img"
              tabIndex={0}
              aria-label={`U.S. county map of ${unit} on ${formatDate(selectedDate)}. Darker blue means higher incidence. Move the pointer or use the arrow keys to navigate spatially between counties.`}
              onPointerMove={onPointerMove}
              onPointerLeave={() => {
                setPointerInsideMap(false);
                setHoveredCounty(null);
              }}
              onPointerDown={onPointerDown}
              onKeyDown={onKeyDown}
            />
            <div className="county-map-legend" aria-label="County incidence color legend">
              <span>Lower</span>
              <div aria-hidden="true">
                {COUNTY_COLORS.map((color) => <i key={color} style={{ backgroundColor: color }} />)}
              </div>
              <span>Higher</span>
              <span className="county-map-missing"><i aria-hidden="true" /> No report</span>
            </div>
          </div>

          <aside
            className="county-map-detail"
            aria-live={!isPlaying && selectedCounty !== null && hoveredCounty === null ? "polite" : "off"}
          >
            <span>{detailStatus}</span>
            <h3>{reportingGroup ?? detailCounty?.name ?? "No county highlighted"}</h3>
            {reportingGroup && detailCounty ? <p>{detailCounty.name}, {detailCounty.state}</p> : null}
            {!reportingGroup && detailCounty ? <p>{detailCounty.state}</p> : null}
            <strong>
              {detailValue === null
                ? "No report"
                : `${detailEncoded === assets.metadata.maximumEncodedValue ? "≥" : detailValue > 0 ? "≈" : ""}${formatValue(detailValue, scale)}`}
            </strong>
            <small>
              {unit}. Values are approximate compact color-bin bounds; ≥ marks the capped top bin.
            </small>
            <time dateTime={selectedDate}>{formatDate(selectedDate)}</time>
            {reportingGroup ? (
              <p className="county-reporting-note">
                The Times reported this combined area as one geography; its component counties
                share the group value on the map.
              </p>
            ) : null}
            <p className="county-keyboard-note">
              Hover or tap to inspect. With the map focused, use the arrow keys to move to the
              nearest county in that direction; press Escape to return to the daily high.
            </p>
          </aside>
        </div>
      ) : null}

      <p className="county-map-source">
        Source: The New York Times county rolling averages · County boundaries: U.S. Census
        geometry via us-atlas · Color values above the archive’s 99.5th percentile are capped.
      </p>
    </div>
  );
}
