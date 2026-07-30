"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Metric = "cases" | "deaths";
type Scale = "average" | "perCapita";
type PeriodId = "all" | "2020" | "2021" | "2022" | "2023";

interface MetricDatum {
  date: string;
  cases: number;
  casesAvg: number;
  casesAvgPer100k: number;
  deaths: number;
  deathsAvg: number;
  deathsAvgPer100k: number;
}

interface NationalDatum extends MetricDatum {
  geoid: string;
}

interface StateDatum extends MetricDatum {
  geoid: string;
  state: string;
}

interface CovidData {
  national: NationalDatum[];
  stateSeries: Map<string, StateDatum[]>;
  statesByDate: Map<string, Map<string, StateDatum>>;
}

interface StateTile {
  name: string;
  abbr: string;
  column: number;
  row: number;
}

interface ComparisonSeries {
  name: string;
  color: string;
  values: number[];
}

const ARCHIVE_START = "2020-01-21";
const ARCHIVE_END = "2023-03-23";
const MAX_SELECTED_STATES = 4;

const PERIODS: ReadonlyArray<{
  id: PeriodId;
  label: string;
  shortLabel: string;
  start: string;
  end: string;
}> = [
  {
    id: "all",
    label: "All waves",
    shortLabel: "All",
    start: ARCHIVE_START,
    end: ARCHIVE_END,
  },
  {
    id: "2020",
    label: "2020",
    shortLabel: "2020",
    start: "2020-01-21",
    end: "2020-12-31",
  },
  {
    id: "2021",
    label: "2021",
    shortLabel: "2021",
    start: "2021-01-01",
    end: "2021-12-31",
  },
  {
    id: "2022",
    label: "2022",
    shortLabel: "2022",
    start: "2022-01-01",
    end: "2022-12-31",
  },
  {
    id: "2023",
    label: "Jan–Mar 2023",
    shortLabel: "2023",
    start: "2023-01-01",
    end: ARCHIVE_END,
  },
];

const STATE_TILES: readonly StateTile[] = [
  { name: "Alabama", abbr: "AL", column: 7, row: 6 },
  { name: "Alaska", abbr: "AK", column: 1, row: 1 },
  { name: "Arizona", abbr: "AZ", column: 2, row: 5 },
  { name: "Arkansas", abbr: "AR", column: 5, row: 5 },
  { name: "California", abbr: "CA", column: 1, row: 4 },
  { name: "Colorado", abbr: "CO", column: 3, row: 4 },
  { name: "Connecticut", abbr: "CT", column: 11, row: 3 },
  { name: "Delaware", abbr: "DE", column: 11, row: 5 },
  { name: "District of Columbia", abbr: "DC", column: 12, row: 5 },
  { name: "Florida", abbr: "FL", column: 8, row: 7 },
  { name: "Georgia", abbr: "GA", column: 8, row: 6 },
  { name: "Hawaii", abbr: "HI", column: 1, row: 6 },
  { name: "Idaho", abbr: "ID", column: 2, row: 2 },
  { name: "Illinois", abbr: "IL", column: 6, row: 3 },
  { name: "Indiana", abbr: "IN", column: 7, row: 3 },
  { name: "Iowa", abbr: "IA", column: 5, row: 3 },
  { name: "Kansas", abbr: "KS", column: 4, row: 5 },
  { name: "Kentucky", abbr: "KY", column: 6, row: 4 },
  { name: "Louisiana", abbr: "LA", column: 5, row: 6 },
  { name: "Maine", abbr: "ME", column: 12, row: 1 },
  { name: "Maryland", abbr: "MD", column: 10, row: 5 },
  { name: "Massachusetts", abbr: "MA", column: 12, row: 2 },
  { name: "Michigan", abbr: "MI", column: 7, row: 2 },
  { name: "Minnesota", abbr: "MN", column: 5, row: 2 },
  { name: "Mississippi", abbr: "MS", column: 6, row: 6 },
  { name: "Missouri", abbr: "MO", column: 5, row: 4 },
  { name: "Montana", abbr: "MT", column: 3, row: 2 },
  { name: "Nebraska", abbr: "NE", column: 4, row: 4 },
  { name: "Nevada", abbr: "NV", column: 2, row: 3 },
  { name: "New Hampshire", abbr: "NH", column: 11, row: 2 },
  { name: "New Jersey", abbr: "NJ", column: 10, row: 4 },
  { name: "New Mexico", abbr: "NM", column: 3, row: 5 },
  { name: "New York", abbr: "NY", column: 10, row: 3 },
  { name: "North Carolina", abbr: "NC", column: 8, row: 5 },
  { name: "North Dakota", abbr: "ND", column: 4, row: 2 },
  { name: "Ohio", abbr: "OH", column: 8, row: 3 },
  { name: "Oklahoma", abbr: "OK", column: 4, row: 6 },
  { name: "Oregon", abbr: "OR", column: 1, row: 3 },
  { name: "Pennsylvania", abbr: "PA", column: 9, row: 3 },
  { name: "Rhode Island", abbr: "RI", column: 12, row: 3 },
  { name: "South Carolina", abbr: "SC", column: 9, row: 5 },
  { name: "South Dakota", abbr: "SD", column: 4, row: 3 },
  { name: "Tennessee", abbr: "TN", column: 6, row: 5 },
  { name: "Texas", abbr: "TX", column: 3, row: 6 },
  { name: "Utah", abbr: "UT", column: 2, row: 4 },
  { name: "Vermont", abbr: "VT", column: 10, row: 2 },
  { name: "Virginia", abbr: "VA", column: 8, row: 4 },
  { name: "Washington", abbr: "WA", column: 1, row: 2 },
  { name: "West Virginia", abbr: "WV", column: 7, row: 4 },
  { name: "Wisconsin", abbr: "WI", column: 6, row: 2 },
  { name: "Wyoming", abbr: "WY", column: 3, row: 3 },
];

const STATE_NAMES = new Set(STATE_TILES.map((tile) => tile.name));
const SERIES_COLORS = ["#0072b2", "#a9363e", "#8a5a00", "#6b4c9a"];

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function asDate(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function formatFullDate(date: string): string {
  return fullDateFormatter.format(asDate(date));
}

function formatShortDate(date: string): string {
  return shortDateFormatter.format(asDate(date));
}

function formatValue(value: number, scale: Scale, compact = false): string {
  if (!Number.isFinite(value)) return "—";
  if (scale === "perCapita") {
    return value.toLocaleString("en-US", {
      maximumFractionDigits: value < 10 ? 2 : 1,
    });
  }
  if (compact && Math.abs(value) >= 10_000) return compactFormatter.format(value);
  return value.toLocaleString("en-US", {
    maximumFractionDigits: value < 100 ? 1 : 0,
  });
}

function parseNumber(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNationalCsv(text: string): NationalDatum[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const cells = line.split(",");
      return {
        date: cells[0] ?? "",
        geoid: cells[1] ?? "USA",
        cases: parseNumber(cells[2]),
        casesAvg: parseNumber(cells[3]),
        casesAvgPer100k: parseNumber(cells[4]),
        deaths: parseNumber(cells[5]),
        deathsAvg: parseNumber(cells[6]),
        deathsAvgPer100k: parseNumber(cells[7]),
      };
    })
    .filter((row) => row.date >= ARCHIVE_START && row.date <= ARCHIVE_END);
}

function parseStateCsv(text: string): StateDatum[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const cells = line.split(",");
      return {
        date: cells[0] ?? "",
        geoid: cells[1] ?? "",
        state: cells[2] ?? "",
        cases: parseNumber(cells[3]),
        casesAvg: parseNumber(cells[4]),
        casesAvgPer100k: parseNumber(cells[5]),
        deaths: parseNumber(cells[6]),
        deathsAvg: parseNumber(cells[7]),
        deathsAvgPer100k: parseNumber(cells[8]),
      };
    })
    .filter(
      (row) =>
        row.date >= ARCHIVE_START &&
        row.date <= ARCHIVE_END &&
        STATE_NAMES.has(row.state),
    );
}

function indexData(national: NationalDatum[], states: StateDatum[]): CovidData {
  const stateSeries = new Map<string, StateDatum[]>();
  const statesByDate = new Map<string, Map<string, StateDatum>>();

  for (const tile of STATE_TILES) stateSeries.set(tile.name, []);

  for (const row of states) {
    stateSeries.get(row.state)?.push(row);
    let dateRows = statesByDate.get(row.date);
    if (!dateRows) {
      dateRows = new Map<string, StateDatum>();
      statesByDate.set(row.date, dateRows);
    }
    dateRows.set(row.state, row);
  }

  for (const series of stateSeries.values()) {
    series.sort((a, b) => a.date.localeCompare(b.date));
  }

  return { national, stateSeries, statesByDate };
}

function metricValue(row: MetricDatum | undefined, metric: Metric, scale: Scale): number {
  if (!row) return 0;
  if (metric === "cases") {
    return scale === "average" ? row.casesAvg : row.casesAvgPer100k;
  }
  return scale === "average" ? row.deathsAvg : row.deathsAvgPer100k;
}

function metricLabel(metric: Metric, scale: Scale): string {
  const noun = metric === "cases" ? "cases" : "deaths";
  return scale === "average"
    ? `daily ${noun}, 7-day average`
    : `daily ${noun} per 100,000, 7-day average`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function useResponsiveCanvas(
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const nextWidth = Math.round(width * pixelRatio);
      const nextHeight = Math.round(height * pixelRatio);

      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      draw(context, width, height);
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  return canvasRef;
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="segmented-field">
      <legend>{label}</legend>
      <div className="segmented-control">
        {options.map((option) => (
          <button
            className={option.value === value ? "is-active" : undefined}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
            aria-pressed={option.value === value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SectionHeading({
  number,
  eyebrow,
  title,
  children,
}: {
  number: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div className="section-kicker">
        <span>{number}</span>
        {eyebrow}
      </div>
      <div className="section-heading-copy">
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </div>
  );
}

function PulseChart({
  points,
  cursorIndex,
  metric,
  scale,
  onCursorChange,
}: {
  points: readonly NationalDatum[];
  cursorIndex: number;
  metric: Metric;
  scale: Scale;
  onCursorChange: (index: number) => void;
}) {
  const values = useMemo(
    () => points.map((point) => metricValue(point, metric, scale)),
    [metric, points, scale],
  );

  const draw = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      if (values.length === 0) return;

      const margin = { top: 18, right: 18, bottom: 28, left: 18 };
      const innerWidth = Math.max(1, width - margin.left - margin.right);
      const innerHeight = Math.max(1, height - margin.top - margin.bottom);
      const minimum = Math.min(0, ...values);
      const maximum = Math.max(1, ...values);
      const range = Math.max(1, maximum - minimum);
      const x = (index: number) =>
        margin.left + (index / Math.max(1, values.length - 1)) * innerWidth;
      const y = (value: number) =>
        margin.top + ((maximum - value) / range) * innerHeight;

      context.strokeStyle = "rgba(35, 34, 30, 0.13)";
      context.lineWidth = 1;
      for (let line = 0; line <= 3; line += 1) {
        const lineY = margin.top + (innerHeight * line) / 3;
        context.beginPath();
        context.moveTo(margin.left, lineY + 0.5);
        context.lineTo(width - margin.right, lineY + 0.5);
        context.stroke();
      }

      const seriesColor = metric === "cases" ? "#006d77" : "#a9363e";
      const seriesWash =
        metric === "cases" ? "rgba(0, 109, 119, 0.48)" : "rgba(169, 54, 62, 0.48)";
      const gradient = context.createLinearGradient(0, margin.top, 0, height);
      gradient.addColorStop(0, seriesWash);
      gradient.addColorStop(1, "rgba(246, 242, 233, 0.02)");

      context.beginPath();
      context.moveTo(x(0), y(0));
      values.forEach((value, index) => context.lineTo(x(index), y(value)));
      context.lineTo(x(values.length - 1), y(0));
      context.closePath();
      context.fillStyle = gradient;
      context.fill();

      context.beginPath();
      values.forEach((value, index) => {
        if (index === 0) context.moveTo(x(index), y(value));
        else context.lineTo(x(index), y(value));
      });
      context.strokeStyle = seriesColor;
      context.lineWidth = 2.25;
      context.lineJoin = "round";
      context.stroke();

      const safeCursor = clamp(cursorIndex, 0, values.length - 1);
      const cursorX = x(safeCursor);
      const cursorY = y(values[safeCursor] ?? 0);
      context.beginPath();
      context.moveTo(cursorX + 0.5, margin.top);
      context.lineTo(cursorX + 0.5, height - margin.bottom);
      context.strokeStyle = "rgba(31, 30, 27, 0.72)";
      context.lineWidth = 1;
      context.stroke();
      context.beginPath();
      context.arc(cursorX, cursorY, 4.5, 0, Math.PI * 2);
      context.fillStyle = seriesColor;
      context.fill();
      context.strokeStyle = "#fffdf5";
      context.lineWidth = 2;
      context.stroke();

      context.fillStyle = "rgba(35, 34, 30, 0.58)";
      context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textBaseline = "bottom";
      context.fillText(formatValue(maximum, scale, true), margin.left, margin.top - 3);
      context.textBaseline = "alphabetic";
      context.fillText(
        formatShortDate(points[0]?.date ?? ARCHIVE_START),
        margin.left,
        height - 6,
      );
      const ending = formatShortDate(points.at(-1)?.date ?? ARCHIVE_END);
      const endingWidth = context.measureText(ending).width;
      context.fillText(ending, width - margin.right - endingWidth, height - 6);
    },
    [cursorIndex, metric, points, scale, values],
  );

  const canvasRef = useResponsiveCanvas(draw);
  const currentPoint = points[cursorIndex];
  const currentValue = values[cursorIndex] ?? 0;

  const updateFromPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - bounds.left - 18) / Math.max(1, bounds.width - 36), 0, 1);
    onCursorChange(Math.round(ratio * Math.max(0, points.length - 1)));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    let nextIndex = cursorIndex;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextIndex -= 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") nextIndex += 1;
    else if (event.key === "PageDown") nextIndex -= 7;
    else if (event.key === "PageUp") nextIndex += 7;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = points.length - 1;
    else return;
    event.preventDefault();
    onCursorChange(clamp(nextIndex, 0, Math.max(0, points.length - 1)));
  };

  return (
    <div className="pulse-chart-shell">
      <canvas
        ref={canvasRef}
        className="pulse-canvas"
        role="slider"
        tabIndex={0}
        aria-label={`National ${metricLabel(metric, scale)} by date`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, points.length - 1)}
        aria-valuenow={cursorIndex}
        aria-valuetext={
          currentPoint
            ? `${formatFullDate(currentPoint.date)}: ${formatValue(currentValue, scale)} ${metricLabel(metric, scale)}`
            : "No date available"
        }
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" || event.currentTarget.hasPointerCapture(event.pointerId)) {
            updateFromPointer(event);
          }
        }}
      >
        National timeline chart. Use the date controls below if your browser does not support canvas.
      </canvas>
      {currentPoint ? (
        <div
          className="chart-cursor-card"
          style={
            {
              "--cursor-position": `${(cursorIndex / Math.max(1, points.length - 1)) * 100}%`,
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <span>{formatShortDate(currentPoint.date)}</span>
          <strong>{formatValue(currentValue, scale, true)}</strong>
        </div>
      ) : null}
    </div>
  );
}

function ComparisonChart({
  dates,
  series,
  cursorIndex,
  scale,
}: {
  dates: readonly string[];
  series: readonly ComparisonSeries[];
  cursorIndex: number;
  scale: Scale;
}) {
  const draw = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      if (dates.length === 0 || series.length === 0) return;
      const margin = { top: 18, right: 18, bottom: 25, left: 18 };
      const innerWidth = Math.max(1, width - margin.left - margin.right);
      const innerHeight = Math.max(1, height - margin.top - margin.bottom);
      const maximum = Math.max(1, ...series.flatMap((line) => line.values));
      const minimum = Math.min(0, ...series.flatMap((line) => line.values));
      const range = Math.max(1, maximum - minimum);
      const x = (index: number) =>
        margin.left + (index / Math.max(1, dates.length - 1)) * innerWidth;
      const y = (value: number) =>
        margin.top + ((maximum - value) / range) * innerHeight;

      context.strokeStyle = "rgba(35, 34, 30, 0.12)";
      context.lineWidth = 1;
      for (let line = 0; line <= 3; line += 1) {
        const lineY = margin.top + (innerHeight * line) / 3;
        context.beginPath();
        context.moveTo(margin.left, lineY + 0.5);
        context.lineTo(width - margin.right, lineY + 0.5);
        context.stroke();
      }

      for (const item of series) {
        context.beginPath();
        item.values.forEach((value, index) => {
          if (index === 0) context.moveTo(x(index), y(value));
          else context.lineTo(x(index), y(value));
        });
        context.strokeStyle = item.color;
        context.lineWidth = 2;
        context.lineJoin = "round";
        context.globalAlpha = 0.9;
        context.stroke();
      }
      context.globalAlpha = 1;

      const safeCursor = clamp(cursorIndex, 0, dates.length - 1);
      const cursorX = x(safeCursor);
      context.beginPath();
      context.moveTo(cursorX + 0.5, margin.top);
      context.lineTo(cursorX + 0.5, height - margin.bottom);
      context.strokeStyle = "rgba(31, 30, 27, 0.6)";
      context.lineWidth = 1;
      context.stroke();

      for (const item of series) {
        const pointY = y(item.values[safeCursor] ?? 0);
        context.beginPath();
        context.arc(cursorX, pointY, 3.5, 0, Math.PI * 2);
        context.fillStyle = item.color;
        context.fill();
        context.strokeStyle = "#fffdf5";
        context.lineWidth = 1.5;
        context.stroke();
      }

      context.fillStyle = "rgba(35, 34, 30, 0.58)";
      context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textBaseline = "bottom";
      context.fillText(formatValue(maximum, scale, true), margin.left, margin.top - 3);
    },
    [cursorIndex, dates, scale, series],
  );
  const canvasRef = useResponsiveCanvas(draw);

  return (
    <canvas
      ref={canvasRef}
      className="comparison-canvas"
      role="img"
      aria-label={`Comparison of ${series.map((item) => item.name).join(", ")} from ${dates[0] ? formatFullDate(dates[0]) : "the selected period"} to ${dates.at(-1) ? formatFullDate(dates.at(-1) as string) : "the selected period"}`}
    >
      State comparison chart.
    </canvas>
  );
}

function MiniWaveCanvas({
  points,
  metric,
  scale,
  selected,
}: {
  points: readonly StateDatum[];
  metric: Metric;
  scale: Scale;
  selected: boolean;
}) {
  const values = useMemo(
    () => points.map((point) => Math.max(0, metricValue(point, metric, scale))),
    [metric, points, scale],
  );
  const draw = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      if (values.length === 0) return;
      const bucketCount = Math.min(64, values.length);
      const bucketSize = values.length / bucketCount;
      const sampled = Array.from({ length: bucketCount }, (_, bucket) => {
        const start = Math.floor(bucket * bucketSize);
        const end = Math.max(start + 1, Math.floor((bucket + 1) * bucketSize));
        return Math.max(0, ...values.slice(start, end));
      });
      const maximum = Math.max(1, ...sampled);
      const gap = 1;
      const barWidth = Math.max(1, width / bucketCount - gap);
      context.fillStyle = selected
        ? metric === "cases"
          ? "#006d77"
          : "#a9363e"
        : "rgba(21, 25, 30, 0.48)";
      sampled.forEach((value, index) => {
        const barHeight = Math.max(1, (value / maximum) * (height - 3));
        context.fillRect(
          (index / bucketCount) * width,
          height - barHeight,
          barWidth,
          barHeight,
        );
      });
    },
    [metric, selected, values],
  );
  const canvasRef = useResponsiveCanvas(draw);
  return <canvas ref={canvasRef} className="mini-wave-canvas" aria-hidden="true" />;
}

function LoadingView() {
  return (
    <main className="atlas-state-view" aria-busy="true">
      <div className="atlas-state-mark">COVID / US</div>
      <div className="loading-pulse" aria-hidden="true" />
      <p className="state-eyebrow">Preparing 63,000+ daily records</p>
      <h1>Rebuilding the pandemic, day by day.</h1>
      <p>Loading the national and state archives…</p>
    </main>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="atlas-state-view" role="alert">
      <div className="atlas-state-mark">COVID / US</div>
      <p className="state-eyebrow">The archive did not load</p>
      <h1>This page needs its two local data files.</h1>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={onRetry}>
        Try loading again
      </button>
    </main>
  );
}

export function CovidAtlas() {
  const [data, setData] = useState<CovidData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [metric, setMetric] = useState<Metric>("cases");
  const [scale, setScale] = useState<Scale>("average");
  const [periodId, setPeriodId] = useState<PeriodId>("all");
  const [selectedDate, setSelectedDate] = useState(ARCHIVE_END);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedStates, setSelectedStates] = useState<string[]>([
    "California",
    "New York",
    "Florida",
    "Texas",
  ]);
  const [selectionMessage, setSelectionMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let ignore = false;

    async function loadArchive() {
      setError(null);
      setData(null);
      try {
        const [nationalResponse, stateResponse] = await Promise.all([
          fetch("/data/us.csv", { signal: controller.signal }),
          fetch("/data/us-states.csv", { signal: controller.signal }),
        ]);
        if (!nationalResponse.ok || !stateResponse.ok) {
          throw new Error("One or more archive files could not be reached.");
        }
        const [nationalText, stateText] = await Promise.all([
          nationalResponse.text(),
          stateResponse.text(),
        ]);
        const national = parseNationalCsv(nationalText);
        const states = parseStateCsv(stateText);
        if (national.length === 0 || states.length === 0) {
          throw new Error("The archive files were empty or did not match the expected format.");
        }
        if (!ignore) setData(indexData(national, states));
      } catch (caught) {
        if (controller.signal.aborted || ignore) return;
        setError(caught instanceof Error ? caught.message : "An unexpected loading error occurred.");
      }
    }

    void loadArchive();
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [reloadKey]);

  const activePeriod = PERIODS.find((period) => period.id === periodId) ?? PERIODS[0];
  const activeNational = useMemo(
    () =>
      data?.national.filter(
        (row) => row.date >= activePeriod.start && row.date <= activePeriod.end,
      ) ?? [],
    [activePeriod.end, activePeriod.start, data],
  );
  const activeDates = useMemo(
    () => activeNational.map((row) => row.date),
    [activeNational],
  );
  const selectedIndex = Math.max(0, activeDates.indexOf(selectedDate));
  const currentNational = activeNational[selectedIndex];
  const currentStateRows = data?.statesByDate.get(selectedDate);

  useEffect(() => {
    if (!isPlaying || activeDates.length < 2) return;
    const timer = window.setInterval(() => {
      setSelectedDate((date) => {
        const index = activeDates.indexOf(date);
        if (index < 0) return activeDates[0];
        if (index >= activeDates.length - 1) {
          setIsPlaying(false);
          return date;
        }
        return activeDates[index + 1];
      });
    }, 110);
    return () => window.clearInterval(timer);
  }, [activeDates, isPlaying]);

  const archiveTotals = useMemo(() => {
    if (!data) return { cases: 0, deaths: 0 };
    return data.national.reduce(
      (totals, row) => ({
        cases: totals.cases + row.cases,
        deaths: totals.deaths + row.deaths,
      }),
      { cases: 0, deaths: 0 },
    );
  }, [data]);

  const nationalPeak = useMemo(() => {
    if (activeNational.length === 0) return undefined;
    return activeNational.reduce((peak, row) =>
      metricValue(row, metric, scale) > metricValue(peak, metric, scale) ? row : peak,
    );
  }, [activeNational, metric, scale]);

  const rankedStates = useMemo(() => {
    return STATE_TILES.map((tile) => ({
      ...tile,
      value: metricValue(currentStateRows?.get(tile.name), metric, scale),
    })).sort((a, b) => b.value - a.value);
  }, [currentStateRows, metric, scale]);

  const comparisonSeries = useMemo<ComparisonSeries[]>(() => {
    if (!data) return [];
    return selectedStates.map((state, index) => {
      const rows = data.stateSeries.get(state) ?? [];
      const valuesByDate = new Map(rows.map((row) => [row.date, row]));
      return {
        name: state,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        values: activeDates.map((date) => metricValue(valuesByDate.get(date), metric, scale)),
      };
    });
  }, [activeDates, data, metric, scale, selectedStates]);

  const fingerprintSeries = useMemo(() => {
    const result = new Map<string, StateDatum[]>();
    if (!data) return result;
    for (const tile of STATE_TILES) {
      const rows = data.stateSeries.get(tile.name) ?? [];
      result.set(
        tile.name,
        rows.filter(
          (row) => row.date >= activePeriod.start && row.date <= activePeriod.end,
        ),
      );
    }
    return result;
  }, [activePeriod.end, activePeriod.start, data]);

  const toggleState = useCallback(
    (state: string) => {
      if (selectedStates.includes(state)) {
        setSelectedStates(selectedStates.filter((item) => item !== state));
        setSelectionMessage(`${state} removed from the comparison.`);
        return;
      }
      if (selectedStates.length >= MAX_SELECTED_STATES) {
        setSelectionMessage("Remove a state before adding another; comparisons hold up to four.");
        return;
      }
      setSelectedStates([...selectedStates, state]);
      setSelectionMessage(`${state} added to the comparison.`);
    },
    [selectedStates],
  );

  const changePeriod = (nextPeriod: PeriodId) => {
    const period = PERIODS.find((item) => item.id === nextPeriod) ?? PERIODS[0];
    setPeriodId(nextPeriod);
    setSelectedDate(period.end);
    setIsPlaying(false);
  };

  const changeCursor = useCallback(
    (index: number) => {
      const date = activeDates[index];
      if (date) {
        setSelectedDate(date);
        setIsPlaying(false);
      }
    },
    [activeDates],
  );

  if (error) {
    return <ErrorView message={error} onRetry={() => setReloadKey((key) => key + 1)} />;
  }
  if (!data) return <LoadingView />;

  const currentValue = metricValue(currentNational, metric, scale);
  const peakValue = metricValue(nationalPeak, metric, scale);
  const tileMaximum = Math.max(1, ...rankedStates.map((state) => Math.max(0, state.value)));
  const rankingMaximum = Math.max(1, ...rankedStates.slice(0, 12).map((state) => state.value));
  const activePeriodLabel = periodId === "all" ? "the full archive" : activePeriod.label;

  return (
    <main className="covid-atlas">
      <header className="site-header">
        <a className="brand-lockup" href="#top" aria-label="The Pandemic Atlas, top">
          <span className="brand-index">C19</span>
          <span>The Pandemic Atlas</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#pulse">Timeline</a>
          <a href="#states">States</a>
          <a href="#compare">Compare</a>
          <a href="#methodology">Notes</a>
        </nav>
        <span className="archive-status"><i aria-hidden="true" /> Historical archive</span>
      </header>

      <section className="editorial-hero" id="top">
        <div className="hero-rail" aria-hidden="true">
          <span>NYT DATA / 2020—2023</span>
          <span>Scroll to explore</span>
        </div>
        <div className="hero-copy">
          <p className="hero-eyebrow">A visual record of COVID-19 in the United States</p>
          <h1>
            <span>1,158 days</span>
            that changed America.
          </h1>
          <p className="hero-deck">
            Trace every reported wave—from the first confirmed case through the final day of
            The New York Times collection. One national story, 51 local realities.
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#pulse">Explore the record <span aria-hidden="true">↓</span></a>
            <a
              className="text-link"
              href="https://github.com/nytimes/covid-19-data"
              target="_blank"
              rel="noreferrer"
            >
              View source data <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
        <div className="hero-ledger" aria-label="Archive summary">
          <div>
            <span>Archive span</span>
            <strong>Jan ’20—Mar ’23</strong>
          </div>
          <div>
            <span>Reported cases*</span>
            <strong>{compactFormatter.format(archiveTotals.cases)}</strong>
          </div>
          <div>
            <span>Reported deaths*</span>
            <strong>{compactFormatter.format(archiveTotals.deaths)}</strong>
          </div>
          <p>*Net sum of daily reports, including later corrections.</p>
        </div>
      </section>

      <div className="explorer-controls" aria-label="Explorer controls">
        <SegmentedControl<Metric>
          label="Metric"
          value={metric}
          options={[
            { value: "cases", label: "Cases" },
            { value: "deaths", label: "Deaths" },
          ]}
          onChange={setMetric}
        />
        <SegmentedControl<Scale>
          label="View"
          value={scale}
          options={[
            { value: "average", label: "7-day average" },
            { value: "perCapita", label: "Per 100k" },
          ]}
          onChange={setScale}
        />
        <fieldset className="period-field">
          <legend>Period</legend>
          <div className="period-control">
            {PERIODS.map((period) => (
              <button
                type="button"
                key={period.id}
                onClick={() => changePeriod(period.id)}
                className={period.id === periodId ? "is-active" : undefined}
                aria-pressed={period.id === periodId}
                aria-label={period.label}
              >
                {period.shortLabel}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <section className="atlas-section pulse-section" id="pulse">
        <SectionHeading
          number="01"
          eyebrow="The national pulse"
          title="Every wave left a different silhouette."
        >
          Move across the chart—or focus it and use the arrow keys—to link every view to a
          single day. Values are smoothed with a seven-day rolling average.
        </SectionHeading>

        <div className="pulse-summary">
          <div>
            <span>Selected day</span>
            <strong>{formatFullDate(selectedDate)}</strong>
          </div>
          <div>
            <span>{metric === "cases" ? "Cases" : "Deaths"} · {scale === "average" ? "daily average" : "per 100k"}</span>
            <strong>{formatValue(currentValue, scale)}</strong>
          </div>
          <div>
            <span>Peak in {activePeriodLabel}</span>
            <strong>{formatValue(peakValue, scale)}</strong>
            <small>{nationalPeak ? formatShortDate(nationalPeak.date) : "—"}</small>
          </div>
        </div>

        <figure className="pulse-figure">
          <PulseChart
            points={activeNational}
            cursorIndex={selectedIndex}
            metric={metric}
            scale={scale}
            onCursorChange={changeCursor}
          />
          <figcaption>
            United States · {metricLabel(metric, scale)}. Drag, hover, or use arrow keys to
            inspect a day.
          </figcaption>
        </figure>
      </section>

      <section className="atlas-section states-section" id="states">
        <SectionHeading
          number="02"
          eyebrow="A country in motion"
          title="Watch the wave move, state by state."
        >
          Press play or scrub the archive. Each tile’s intensity is scaled against the highest
          state value on that day; select up to four states for a direct comparison below.
        </SectionHeading>

        <div className="time-console">
          <button
            type="button"
            className="play-button"
            onClick={() => {
              if (!isPlaying && selectedIndex >= activeDates.length - 1) {
                setSelectedDate(activeDates[0] ?? selectedDate);
              }
              setIsPlaying((playing) => !playing);
            }}
            aria-label={isPlaying ? "Pause date animation" : "Play date animation"}
          >
            <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <div className="date-readout" aria-live="polite">
            <span>Viewing</span>
            <strong>{formatFullDate(selectedDate)}</strong>
          </div>
          <div className="date-slider-wrap">
            <input
              type="range"
              min={0}
              max={Math.max(0, activeDates.length - 1)}
              value={selectedIndex}
              onChange={(event) => changeCursor(Number(event.target.value))}
              aria-label="Archive date"
              aria-valuetext={formatFullDate(selectedDate)}
            />
            <div aria-hidden="true">
              <span>{activeDates[0] ? formatShortDate(activeDates[0]) : ""}</span>
              <span>{activeDates.at(-1) ? formatShortDate(activeDates.at(-1) as string) : ""}</span>
            </div>
          </div>
        </div>

        <div className="map-layout">
          <div>
            <div className="tile-map" aria-label={`State tile map for ${formatFullDate(selectedDate)}`}>
              {STATE_TILES.map((tile) => {
                const value = metricValue(currentStateRows?.get(tile.name), metric, scale);
                const intensity = Math.sqrt(Math.max(0, value) / tileMaximum);
                const isSelected = selectedStates.includes(tile.name);
                return (
                  <button
                    key={tile.name}
                    type="button"
                    className={`state-tile${isSelected ? " is-selected" : ""}`}
                    style={
                      {
                        gridColumn: tile.column,
                        gridRow: tile.row,
                        "--tile-intensity": intensity.toFixed(3),
                      } as CSSProperties
                    }
                    aria-pressed={isSelected}
                    aria-label={`${tile.name}: ${formatValue(value, scale)} ${metricLabel(metric, scale)}. ${isSelected ? "Remove from" : "Add to"} comparison.`}
                    onClick={() => toggleState(tile.name)}
                  >
                    <strong>{tile.abbr}</strong>
                    <span>{formatValue(value, scale, true)}</span>
                  </button>
                );
              })}
            </div>
            <div className="map-legend" aria-label="Map intensity legend">
              <span>Lower</span><i aria-hidden="true" /><span>Higher</span>
            </div>
          </div>

          <aside className="map-note">
            <span className="note-index">Reading the map</span>
            <h3>Intensity is relative, not absolute.</h3>
            <p>
              The darkest tile marks that day’s state maximum. Switch to “Per 100k” for a
              population-adjusted comparison; raw averages naturally favor larger states.
            </p>
            <div className="selected-counter">
              <strong>{selectedStates.length}/{MAX_SELECTED_STATES}</strong>
              <span>states selected</span>
            </div>
          </aside>
        </div>
      </section>

      <section className="atlas-section comparison-section" id="compare">
        <SectionHeading
          number="03"
          eyebrow="Compare trajectories"
          title="No two outbreaks moved in lockstep."
        >
          Selected states share a date axis. Use per-capita values for the fairest comparison
          across states of different sizes.
        </SectionHeading>

        <div className="comparison-panel">
          <div className="comparison-toolbar">
            <div className="state-chips" aria-label="Selected states">
              {selectedStates.length === 0 ? (
                <p>Select a state from the map, ranking, or wave cards.</p>
              ) : (
                selectedStates.map((state, index) => (
                  <button
                    type="button"
                    className="state-chip"
                    key={state}
                    onClick={() => toggleState(state)}
                    style={{ "--series-color": SERIES_COLORS[index] } as CSSProperties}
                    aria-label={`Remove ${state} from comparison`}
                  >
                    <i aria-hidden="true" /> {state} <span aria-hidden="true">×</span>
                  </button>
                ))
              )}
            </div>
            <p className="selection-message" aria-live="polite">{selectionMessage}</p>
          </div>

          {selectedStates.length > 0 ? (
            <>
              <ComparisonChart
                dates={activeDates}
                series={comparisonSeries}
                cursorIndex={selectedIndex}
                scale={scale}
              />
              <div className="comparison-readout" aria-label={`Values on ${formatFullDate(selectedDate)}`}>
                <span>{formatShortDate(selectedDate)}</span>
                {comparisonSeries.map((series) => (
                  <div key={series.name}>
                    <i style={{ backgroundColor: series.color }} aria-hidden="true" />
                    <span>{series.name}</span>
                    <strong>{formatValue(series.values[selectedIndex] ?? 0, scale)}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="comparison-empty">Choose at least one state to draw a trajectory.</div>
          )}
        </div>

        <div className="ranking-panel">
          <div className="ranking-heading">
            <div>
              <span>Daily ranking</span>
              <h3>Where the reported burden was highest</h3>
            </div>
            <time dateTime={selectedDate}>{formatFullDate(selectedDate)}</time>
          </div>
          <ol className="ranked-bars">
            {rankedStates.slice(0, 12).map((state, index) => {
              const isSelected = selectedStates.includes(state.name);
              return (
                <li key={state.name} className={isSelected ? "is-selected" : undefined}>
                  <button
                    type="button"
                    onClick={() => toggleState(state.name)}
                    aria-pressed={isSelected}
                    aria-label={`${state.name}, rank ${index + 1}, ${formatValue(state.value, scale)} ${metricLabel(metric, scale)}. ${isSelected ? "Remove from" : "Add to"} comparison.`}
                  >
                    <span className="rank-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="rank-name">{state.name}</span>
                    <span
                      className="rank-bar"
                      aria-hidden="true"
                      style={
                        {
                          "--bar-size": `${clamp((Math.max(0, state.value) / rankingMaximum) * 100, 0, 100)}%`,
                        } as CSSProperties
                      }
                    />
                    <strong>{formatValue(state.value, scale)}</strong>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section className="atlas-section fingerprints-section" id="fingerprints">
        <SectionHeading
          number="04"
          eyebrow="51 wave fingerprints"
          title="The whole archive, compressed into a glance."
        >
          Each barcode preserves the shape of a state’s selected-period trajectory. Taller
          strokes mark higher reported values within that state—not between states.
        </SectionHeading>

        <div className="fingerprint-grid">
          {[...STATE_TILES]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((tile) => {
              const rows = fingerprintSeries.get(tile.name) ?? [];
              const current = metricValue(currentStateRows?.get(tile.name), metric, scale);
              const peak = rows.reduce(
                (highest, row) => Math.max(highest, metricValue(row, metric, scale)),
                0,
              );
              const isSelected = selectedStates.includes(tile.name);
              return (
                <button
                  type="button"
                  className={`fingerprint-card${isSelected ? " is-selected" : ""}`}
                  key={tile.name}
                  onClick={() => toggleState(tile.name)}
                  aria-pressed={isSelected}
                  aria-label={`${tile.name}: ${formatValue(current, scale)} on ${formatFullDate(selectedDate)}, period peak ${formatValue(peak, scale)}. ${isSelected ? "Remove from" : "Add to"} comparison.`}
                >
                  <span className="fingerprint-title"><strong>{tile.abbr}</strong>{tile.name}</span>
                  <MiniWaveCanvas points={rows} metric={metric} scale={scale} selected={isSelected} />
                  <span className="fingerprint-meta">
                    <span>Now <b>{formatValue(current, scale, true)}</b></span>
                    <span>Peak <b>{formatValue(peak, scale, true)}</b></span>
                  </span>
                </button>
              );
            })}
        </div>
      </section>

      <section className="methodology-section" id="methodology">
        <div className="methodology-intro">
          <span>Before you interpret the lines</span>
          <h2>This is a record of reporting—not a perfect count of infection.</h2>
        </div>
        <div className="methodology-grid">
          <article>
            <span>01 / Source</span>
            <h3>The New York Times archive</h3>
            <p>
              This explorer reads local snapshots of the Times’s public U.S. and state data.
              The archive ends March 23, 2023, when its recurring collection ended.
            </p>
          </article>
          <article>
            <span>02 / Smoothing</span>
            <h3>Seven-day averages</h3>
            <p>
              All plotted values use rolling seven-day averages to soften weekday reporting
              cycles. “Per 100k” uses the archive’s population-normalized fields, based on 2019
              Census estimates.
            </p>
          </article>
          <article>
            <span>03 / Caveats</span>
            <h3>Reports can move backward</h3>
            <p>
              Testing access, definitions, holiday gaps, backfills and later corrections all
              shape the series. Revisions can create spikes or negative values; deaths also lag
              infections by an uneven interval.
            </p>
          </article>
          <article>
            <span>04 / Reading</span>
            <h3>Context before conclusions</h3>
            <p>
              Case counts understate infections and are not directly comparable across testing
              eras. These charts describe reported history; they are not estimates of individual
              risk or present-day conditions.
            </p>
          </article>
        </div>
        <div className="source-strip">
          <p>Data: The New York Times · Jan. 21, 2020—Mar. 23, 2023</p>
          <a href="https://github.com/nytimes/covid-19-data" target="_blank" rel="noreferrer">
            Repository & methodology <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>

      <footer className="atlas-footer">
        <div className="brand-lockup"><span className="brand-index">C19</span><span>The Pandemic Atlas</span></div>
        <p>A historical data study. Not a live public-health dashboard.</p>
        <a href="#top">Back to top <span aria-hidden="true">↑</span></a>
      </footer>
    </main>
  );
}

export default CovidAtlas;
