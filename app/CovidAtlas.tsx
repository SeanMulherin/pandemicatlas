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
import {
  centeredMovingAverage,
  cumulativeCounts,
  dispersionIndex,
  estimatePiecewiseIntensity,
  lag1Autocorrelation,
  pearsonResiduals,
  poissonAic,
  poissonLogLikelihood,
  quantileBands,
  sanitizeNegativeCorrections,
  simulatePoissonPaths,
  type NegativeCorrectionStrategy,
  type QuantileBands,
} from "./pointProcess";

type Metric = "cases" | "deaths";
type ModelKind = "homogeneous" | "piecewise";
type LabTab = "observe" | "fit" | "simulate" | "diagnose" | "data";

interface RawDatum {
  date: string;
  cases: number;
  deaths: number;
}

interface ArchiveData {
  national: RawDatum[];
  byPlace: Map<string, RawDatum[]>;
  places: string[];
}

interface AnalysisRow {
  date: string;
  raw: number;
  count: number;
  smoothed: number;
  homogeneous: number;
  piecewise: number;
  fitted: number;
  residual: number;
  cumulative: number;
  compensator: number;
  isCorrection: boolean;
}

interface ModelSummary {
  label: string;
  parameters: number;
  logLikelihood: number;
  aic: number;
  pearsonRatio: number;
}

const ARCHIVE_START = "2020-01-21";
const ARCHIVE_END = "2023-03-23";

const PRESETS = [
  { id: "full", label: "Full archive", start: ARCHIVE_START, end: ARCHIVE_END },
  { id: "first", label: "First wave", start: "2020-03-01", end: "2020-06-30" },
  { id: "winter", label: "Winter 2020–21", start: "2020-10-01", end: "2021-03-01" },
  { id: "delta", label: "Delta period", start: "2021-06-01", end: "2021-11-30" },
  { id: "omicron", label: "Omicron period", start: "2021-11-15", end: "2022-03-15" },
] as const;

const TABS: Array<{ id: LabTab; label: string; index: string }> = [
  { id: "observe", label: "Observe", index: "01" },
  { id: "fit", label: "Fit intensity", index: "02" },
  { id: "simulate", label: "Simulate", index: "03" },
  { id: "diagnose", label: "Diagnose", index: "04" },
  { id: "data", label: "Data & methods", index: "05" },
];

const GUIDES = {
  counting: {
    label: "What is N(t)?",
    title: "Build the counting process",
    text: "Start with daily increments Yₜ, then accumulate them. N(t) can only increase after the reporting corrections have been handled.",
    steps: ["Choose a short wave window.", "Hover over a daily bar.", "Compare Yₜ with the change in N(t)."],
  },
  intensity: {
    label: "Is intensity constant?",
    title: "Challenge the homogeneous model",
    text: "A homogeneous Poisson process uses one rate for the entire window. Pandemic waves make that assumption easy to test—and usually easy to reject.",
    steps: ["Open Fit intensity.", "Compare constant and piecewise AIC.", "Change the block width."],
  },
  poisson: {
    label: "Does Poisson variance fit?",
    title: "Inspect equidispersion",
    text: "Poisson increments have variance equal to their mean. A dispersion index far above one points to heterogeneity, dependence, or an inadequate mean model.",
    steps: ["Open Diagnose.", "Read variance ÷ mean.", "Inspect residual runs beyond ±2."],
  },
  aggregation: {
    label: "What does daily binning hide?",
    title: "Respect the observation interval",
    text: "These records identify an expected count per day, μₜ. They do not reveal within-day event times, infection times, or individual transmission links.",
    steps: ["Switch between cases and deaths.", "Read the data audit.", "Avoid interpreting report dates as onset dates."],
  },
} as const;

const fullDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const integerNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatDate(date: string): string {
  return fullDate.format(new Date(`${date}T12:00:00Z`));
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.abs(value) >= 10_000 ? compactNumber.format(value) : integerNumber.format(value);
}

function formatStat(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function parseNationalCsv(text: string): RawDatum[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const cells = line.split(",");
      return { date: cells[0] ?? "", cases: Number(cells[2] ?? 0), deaths: Number(cells[5] ?? 0) };
    })
    .filter((row) => row.date && Number.isFinite(row.cases) && Number.isFinite(row.deaths));
}

function parseStateCsv(text: string): Map<string, RawDatum[]> {
  const byPlace = new Map<string, RawDatum[]>();
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const cells = line.split(",");
    const place = cells[2] ?? "";
    if (!place) continue;
    const row = {
      date: cells[0] ?? "",
      cases: Number(cells[3] ?? 0),
      deaths: Number(cells[6] ?? 0),
    };
    if (!row.date || !Number.isFinite(row.cases) || !Number.isFinite(row.deaths)) continue;
    const series = byPlace.get(place) ?? [];
    series.push(row);
    byPlace.set(place, series);
  }
  for (const series of byPlace.values()) series.sort((a, b) => a.date.localeCompare(b.date));
  return byPlace;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function useResponsiveCanvas(
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const render = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      draw(context, bounds.width, bounds.height);
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);
  return ref;
}

function drawGrid(context: CanvasRenderingContext2D, width: number, top: number, bottom: number) {
  context.save();
  context.strokeStyle = "rgba(16, 26, 29, 0.11)";
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = top + ((bottom - top) * index) / 4;
    context.beginPath();
    context.moveTo(54, y + 0.5);
    context.lineTo(width - 16, y + 0.5);
    context.stroke();
  }
  context.restore();
}

function CanvasFrame({
  children,
  dates,
}: {
  children: React.ReactNode;
  dates: readonly string[];
}) {
  return (
    <div className="canvas-frame">
      {children}
      <div className="canvas-axis" aria-hidden="true">
        <span>{dates[0] ? formatDate(dates[0]) : "—"}</span>
        <span>{dates.at(-1) ? formatDate(dates.at(-1) as string) : "—"}</span>
      </div>
    </div>
  );
}

function InteractiveCanvas({
  canvasRef,
  className,
  label,
  rowCount,
  cursor,
  onCursor,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  className: string;
  label: string;
  rowCount: number;
  cursor: number;
  onCursor: (index: number) => void;
}) {
  const updatePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - bounds.left - 54) / Math.max(1, bounds.width - 70), 0, 1);
    onCursor(Math.round(ratio * Math.max(0, rowCount - 1)));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    const step = event.shiftKey ? 7 : 1;
    let next = cursor;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rowCount - 1;
    else return;
    event.preventDefault();
    onCursor(clamp(next, 0, Math.max(0, rowCount - 1)));
  };
  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, rowCount - 1)}
      aria-valuenow={cursor}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updatePointer(event);
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse" || event.currentTarget.hasPointerCapture(event.pointerId)) {
          updatePointer(event);
        }
      }}
    >
      {label}
    </canvas>
  );
}

function IncrementChart({ rows, metric, cursor, onCursor }: {
  rows: readonly AnalysisRow[];
  metric: Metric;
  cursor: number;
  onCursor: (index: number) => void;
}) {
  const draw = useCallback((context: CanvasRenderingContext2D, width: number, height: number) => {
    if (!rows.length) return;
    const top = 24;
    const bottom = height - 20;
    const left = 54;
    const right = width - 16;
    const innerWidth = right - left;
    const maximum = Math.max(1, ...rows.flatMap((row) => [row.count, row.smoothed, row.fitted]));
    const x = (index: number) => left + (index / Math.max(1, rows.length - 1)) * innerWidth;
    const y = (value: number) => bottom - (Math.max(0, value) / maximum) * (bottom - top);
    drawGrid(context, width, top, bottom);

    const barWidth = Math.max(1, innerWidth / rows.length - 0.4);
    context.fillStyle = metric === "cases" ? "rgba(8,127,107,.42)" : "rgba(183,71,63,.42)";
    rows.forEach((row, index) => {
      const barTop = y(row.count);
      context.fillRect(x(index) - barWidth / 2, barTop, barWidth, bottom - barTop);
      if (row.isCorrection) {
        context.strokeStyle = "#b7473f";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(x(index), bottom - 8);
        context.lineTo(x(index), bottom + 1);
        context.stroke();
      }
    });

    context.beginPath();
    rows.forEach((row, index) => {
      if (index === 0) context.moveTo(x(index), y(row.smoothed));
      else context.lineTo(x(index), y(row.smoothed));
    });
    context.strokeStyle = metric === "cases" ? "#087f6b" : "#b7473f";
    context.lineWidth = 1.7;
    context.stroke();

    context.beginPath();
    rows.forEach((row, index) => {
      if (index === 0) context.moveTo(x(index), y(row.fitted));
      else context.lineTo(x(index), y(row.fitted));
    });
    context.strokeStyle = "#315ebc";
    context.lineWidth = 2.2;
    context.setLineDash([7, 4]);
    context.stroke();
    context.setLineDash([]);

    const safe = clamp(cursor, 0, rows.length - 1);
    context.strokeStyle = "#101a1d";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x(safe), top);
    context.lineTo(x(safe), bottom);
    context.stroke();
    context.fillStyle = "#101a1d";
    context.font = "11px ui-monospace, monospace";
    context.fillText(formatCount(maximum), 8, top + 4);
    context.fillText("0", 38, bottom + 3);
  }, [cursor, metric, rows]);
  const ref = useResponsiveCanvas(draw);
  return (
    <CanvasFrame dates={rows.map((row) => row.date)}>
      <InteractiveCanvas canvasRef={ref} className="increment-canvas" label={`Daily reported ${metric}, fitted intensity, and correction marks`} rowCount={rows.length} cursor={cursor} onCursor={onCursor} />
    </CanvasFrame>
  );
}

function CumulativeChart({ rows, cursor, onCursor }: {
  rows: readonly AnalysisRow[];
  cursor: number;
  onCursor: (index: number) => void;
}) {
  const draw = useCallback((context: CanvasRenderingContext2D, width: number, height: number) => {
    if (!rows.length) return;
    const top = 20;
    const bottom = height - 18;
    const left = 54;
    const right = width - 16;
    const maximum = Math.max(1, rows.at(-1)?.cumulative ?? 0, rows.at(-1)?.compensator ?? 0);
    const x = (index: number) => left + (index / Math.max(1, rows.length - 1)) * (right - left);
    const y = (value: number) => bottom - (value / maximum) * (bottom - top);
    drawGrid(context, width, top, bottom);
    const line = (field: "cumulative" | "compensator", color: string, dash: number[]) => {
      context.beginPath();
      rows.forEach((row, index) => {
        if (index === 0) context.moveTo(x(index), y(row[field]));
        else context.lineTo(x(index), y(row[field]));
      });
      context.strokeStyle = color;
      context.lineWidth = field === "cumulative" ? 2.4 : 2;
      context.setLineDash(dash);
      context.stroke();
      context.setLineDash([]);
    };
    line("cumulative", "#087f6b", []);
    line("compensator", "#315ebc", [7, 4]);
    const safe = clamp(cursor, 0, rows.length - 1);
    context.strokeStyle = "#101a1d";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x(safe), top);
    context.lineTo(x(safe), bottom);
    context.stroke();
    context.fillStyle = "#101a1d";
    context.font = "11px ui-monospace, monospace";
    context.fillText(formatCount(maximum), 8, top + 4);
  }, [cursor, rows]);
  const ref = useResponsiveCanvas(draw);
  return (
    <CanvasFrame dates={rows.map((row) => row.date)}>
      <InteractiveCanvas canvasRef={ref} className="cumulative-canvas" label="Observed counting process N(t) and fitted cumulative intensity Lambda(t)" rowCount={rows.length} cursor={cursor} onCursor={onCursor} />
    </CanvasFrame>
  );
}

function ResidualChart({ rows, cursor, onCursor }: {
  rows: readonly AnalysisRow[];
  cursor: number;
  onCursor: (index: number) => void;
}) {
  const draw = useCallback((context: CanvasRenderingContext2D, width: number, height: number) => {
    if (!rows.length) return;
    const top = 18;
    const bottom = height - 18;
    const left = 54;
    const right = width - 16;
    const maximum = Math.max(3, ...rows.map((row) => Math.min(12, Math.abs(row.residual))));
    const center = (top + bottom) / 2;
    const x = (index: number) => left + (index / Math.max(1, rows.length - 1)) * (right - left);
    const y = (value: number) => center - (clamp(value, -maximum, maximum) / maximum) * ((bottom - top) / 2);
    context.fillStyle = "rgba(49,94,188,.07)";
    context.fillRect(left, y(2), right - left, y(-2) - y(2));
    context.strokeStyle = "rgba(16,26,29,.18)";
    context.beginPath(); context.moveTo(left, center); context.lineTo(right, center); context.stroke();
    context.setLineDash([4, 4]);
    for (const bound of [-2, 2]) {
      context.beginPath(); context.moveTo(left, y(bound)); context.lineTo(right, y(bound)); context.stroke();
    }
    context.setLineDash([]);
    const barWidth = Math.max(1, (right - left) / rows.length - 0.5);
    rows.forEach((row, index) => {
      context.fillStyle = Math.abs(row.residual) > 2 ? "rgba(183,71,63,.78)" : "rgba(49,94,188,.58)";
      const valueY = y(row.residual);
      context.fillRect(x(index) - barWidth / 2, Math.min(center, valueY), barWidth, Math.abs(center - valueY));
    });
    const safe = clamp(cursor, 0, rows.length - 1);
    context.strokeStyle = "#101a1d";
    context.beginPath(); context.moveTo(x(safe), top); context.lineTo(x(safe), bottom); context.stroke();
    context.fillStyle = "#101a1d";
    context.font = "11px ui-monospace, monospace";
    context.fillText(`+${formatStat(maximum, 0)}`, 15, top + 4);
    context.fillText(`−${formatStat(maximum, 0)}`, 15, bottom);
  }, [cursor, rows]);
  const ref = useResponsiveCanvas(draw);
  return (
    <CanvasFrame dates={rows.map((row) => row.date)}>
      <InteractiveCanvas canvasRef={ref} className="residual-canvas" label="Pearson residuals by date with plus and minus two reference band" rowCount={rows.length} cursor={cursor} onCursor={onCursor} />
    </CanvasFrame>
  );
}

function SimulationChart({ rows, outer, inner, cursor, onCursor }: {
  rows: readonly AnalysisRow[];
  outer: QuantileBands;
  inner: QuantileBands;
  cursor: number;
  onCursor: (index: number) => void;
}) {
  const draw = useCallback((context: CanvasRenderingContext2D, width: number, height: number) => {
    if (!rows.length || !outer.upper.length) return;
    const top = 18;
    const bottom = height - 18;
    const left = 54;
    const right = width - 16;
    const maximum = Math.max(1, rows.at(-1)?.cumulative ?? 0, ...outer.upper);
    const x = (index: number) => left + (index / Math.max(1, rows.length - 1)) * (right - left);
    const y = (value: number) => bottom - (value / maximum) * (bottom - top);
    drawGrid(context, width, top, bottom);
    const band = (lower: readonly number[], upper: readonly number[], fill: string) => {
      context.beginPath();
      upper.forEach((value, index) => index === 0 ? context.moveTo(x(index), y(value)) : context.lineTo(x(index), y(value)));
      for (let index = lower.length - 1; index >= 0; index -= 1) context.lineTo(x(index), y(lower[index]));
      context.closePath(); context.fillStyle = fill; context.fill();
    };
    band(outer.lower, outer.upper, "rgba(217,154,36,.16)");
    band(inner.lower, inner.upper, "rgba(217,154,36,.27)");
    context.beginPath();
    outer.median.forEach((value, index) => index === 0 ? context.moveTo(x(index), y(value)) : context.lineTo(x(index), y(value)));
    context.strokeStyle = "#b7770b"; context.lineWidth = 1.8; context.setLineDash([6, 4]); context.stroke(); context.setLineDash([]);
    context.beginPath();
    rows.forEach((row, index) => index === 0 ? context.moveTo(x(index), y(row.cumulative)) : context.lineTo(x(index), y(row.cumulative)));
    context.strokeStyle = "#087f6b"; context.lineWidth = 2.4; context.stroke();
    const safe = clamp(cursor, 0, rows.length - 1);
    context.strokeStyle = "#101a1d"; context.lineWidth = 1;
    context.beginPath(); context.moveTo(x(safe), top); context.lineTo(x(safe), bottom); context.stroke();
    context.fillStyle = "#101a1d"; context.font = "11px ui-monospace, monospace";
    context.fillText(formatCount(maximum), 8, top + 4);
  }, [cursor, inner.lower, inner.upper, outer.lower, outer.median, outer.upper, rows]);
  const ref = useResponsiveCanvas(draw);
  return (
    <CanvasFrame dates={rows.map((row) => row.date)}>
      <InteractiveCanvas canvasRef={ref} className="simulation-canvas" label="Observed cumulative reports against central 50 and 90 percent Poisson simulation bands" rowCount={rows.length} cursor={cursor} onCursor={onCursor} />
    </CanvasFrame>
  );
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className={`metric-card${tone ? ` is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function FigurePanel({ index, title, subtitle, legend, children }: {
  index: string;
  title: string;
  subtitle: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <figure className="analysis-panel">
      <header className="panel-header">
        <div><span className="figure-index">FIG {index}</span><h2>{title}</h2><p>{subtitle}</p></div>
        {legend ? <div className="chart-legend">{legend}</div> : null}
      </header>
      {children}
    </figure>
  );
}

function LegendItem({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span><i className={`legend-mark is-${kind}`} aria-hidden="true" />{children}</span>;
}

function NearbyTable({ rows, cursor }: { rows: readonly AnalysisRow[]; cursor: number }) {
  const start = clamp(cursor - 3, 0, Math.max(0, rows.length - 7));
  return (
    <details className="chart-table-fallback">
      <summary>Accessible values near the selected day</summary>
      <div className="table-scroll"><table><thead><tr><th>Date</th><th>Reported Yₜ</th><th>Analysis count</th><th>Fitted μₜ</th><th>N(t)</th><th>Residual</th></tr></thead>
        <tbody>{rows.slice(start, start + 7).map((row) => <tr key={row.date} className={row.date === rows[cursor]?.date ? "is-current" : undefined}><th>{formatDate(row.date)}</th><td>{integerNumber.format(row.raw)}</td><td>{integerNumber.format(row.count)}</td><td>{formatStat(row.fitted, 1)}</td><td>{integerNumber.format(row.cumulative)}</td><td>{formatStat(row.residual)}</td></tr>)}</tbody>
      </table></div>
    </details>
  );
}

function LoadingView() {
  return <main className="lab-state" aria-busy="true"><div className="lab-logo">λ</div><p>Loading 63,000+ grouped daily reports…</p><div className="lab-loader" aria-hidden="true"><i /><i /><i /></div></main>;
}

function ErrorView({ message, retry }: { message: string; retry: () => void }) {
  return <main className="lab-state" role="alert"><div className="lab-logo">!</div><h1>The archive could not be loaded.</h1><p>{message}</p><button type="button" className="primary-action" onClick={retry}>Try again</button></main>;
}

export function CovidAtlas() {
  const [archive, setArchive] = useState<ArchiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [place, setPlace] = useState("United States");
  const [metric, setMetric] = useState<Metric>("cases");
  const [startDate, setStartDate] = useState("2021-11-15");
  const [endDate, setEndDate] = useState("2022-03-15");
  const [correction, setCorrection] = useState<NegativeCorrectionStrategy>("redistribute-backward");
  const [bandwidth, setBandwidth] = useState(14);
  const [model, setModel] = useState<ModelKind>("piecewise");
  const [simulationCount, setSimulationCount] = useState(50);
  const [seed, setSeed] = useState(2021);
  const [tab, setTab] = useState<LabTab>("observe");
  const [cursor, setCursor] = useState(0);
  const [guide, setGuide] = useState<keyof typeof GUIDES>("counting");
  const [shareStatus, setShareStatus] = useState("");
  const [showAllRows, setShowAllRows] = useState(false);
  const [queryReady, setQueryReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/data/us.csv", { signal: controller.signal }),
      fetch("/data/us-states.csv", { signal: controller.signal }),
    ]).then(async ([us, states]) => {
      if (!us.ok || !states.ok) throw new Error("The local NYT data snapshots were not available.");
      const national = parseNationalCsv(await us.text());
      const byPlace = parseStateCsv(await states.text());
      setArchive({ national, byPlace, places: ["United States", ...Array.from(byPlace.keys()).sort()] });
    }).catch((caught) => {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Unexpected data error.");
    });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextMetric = params.get("metric");
    const nextModel = params.get("model");
    const nextCorrection = params.get("correction");
    const nextTab = params.get("tab");
    const timer = window.setTimeout(() => {
      if (nextMetric === "cases" || nextMetric === "deaths") setMetric(nextMetric);
      if (nextModel === "homogeneous" || nextModel === "piecewise") setModel(nextModel);
      if (nextCorrection === "clamp" || nextCorrection === "redistribute-backward") setCorrection(nextCorrection);
      if (TABS.some((item) => item.id === nextTab)) setTab(nextTab as LabTab);
      if (params.get("place")) setPlace(params.get("place") as string);
      if (/^202\d-\d{2}-\d{2}$/.test(params.get("start") ?? "")) setStartDate(params.get("start") as string);
      if (/^202\d-\d{2}-\d{2}$/.test(params.get("end") ?? "")) setEndDate(params.get("end") as string);
      const nextBandwidth = Number(params.get("width"));
      if ([7, 14, 28].includes(nextBandwidth)) setBandwidth(nextBandwidth);
      const nextSeed = Number(params.get("seed"));
      if (Number.isInteger(nextSeed)) setSeed(nextSeed);
      setQueryReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!queryReady) return;
    const params = new URLSearchParams({ place, metric, start: startDate, end: endDate, correction, width: String(bandwidth), model, seed: String(seed), tab });
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [bandwidth, correction, endDate, metric, model, place, queryReady, seed, startDate, tab]);

  const sourceSeries = useMemo(
    () => place === "United States" ? archive?.national ?? [] : archive?.byPlace.get(place) ?? [],
    [archive, place],
  );
  const sourceWindow = useMemo(() => sourceSeries.filter((row) => row.date >= startDate && row.date <= endDate), [endDate, sourceSeries, startDate]);

  const analysis = useMemo(() => {
    const raw = sourceWindow.map((row) => Math.round(metric === "cases" ? row.cases : row.deaths));
    const sanitized = sanitizeNegativeCorrections(raw, correction);
    const counts = sanitized.cleaned;
    const homogeneousRate = counts.length ? counts.reduce((sum, value) => sum + value, 0) / counts.length : 0;
    const homogeneous = new Array(counts.length).fill(homogeneousRate) as number[];
    const piecewiseEstimate = estimatePiecewiseIntensity(counts, bandwidth);
    const piecewise = piecewiseEstimate.intensity;
    const smoothed = centeredMovingAverage(counts, bandwidth);
    const fitted = model === "homogeneous" ? homogeneous : piecewise;
    const cumulative = cumulativeCounts(counts);
    const compensator = cumulativeCounts(fitted);
    const residuals = pearsonResiduals(counts, fitted);
    const rows: AnalysisRow[] = sourceWindow.map((row, index) => ({
      date: row.date,
      raw: raw[index],
      count: counts[index],
      smoothed: smoothed[index],
      homogeneous: homogeneous[index],
      piecewise: piecewise[index],
      fitted: fitted[index],
      residual: residuals[index],
      cumulative: cumulative[index],
      compensator: compensator[index],
      isCorrection: raw[index] < 0,
    }));
    const ratio = (expected: readonly number[], parameters: number) => {
      const residual = pearsonResiduals(counts, expected).filter(Number.isFinite);
      return residual.reduce((sum, value) => sum + value * value, 0) / Math.max(1, residual.length - parameters);
    };
    const models: ModelSummary[] = [
      { label: "Homogeneous", parameters: 1, logLikelihood: poissonLogLikelihood(counts, homogeneous), aic: poissonAic(counts, homogeneous, 1), pearsonRatio: ratio(homogeneous, 1) },
      { label: `${bandwidth}-day piecewise`, parameters: piecewiseEstimate.segments.length, logLikelihood: poissonLogLikelihood(counts, piecewise), aic: poissonAic(counts, piecewise, piecewiseEstimate.segments.length), pearsonRatio: ratio(piecewise, piecewiseEstimate.segments.length) },
    ];
    const finiteResiduals = residuals.filter(Number.isFinite);
    return {
      rows,
      fitted,
      models,
      correctionSummary: sanitized.summary,
      total: cumulative.at(-1) ?? 0,
      mean: homogeneousRate,
      dispersion: dispersionIndex(counts),
      residualAcf: lag1Autocorrelation(finiteResiduals),
      withinTwo: finiteResiduals.length ? finiteResiduals.filter((value) => Math.abs(value) <= 2).length / finiteResiduals.length : Number.NaN,
    };
  }, [bandwidth, correction, metric, model, sourceWindow]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCursor(analysis.rows.length ? Math.floor((analysis.rows.length - 1) * 0.62) : 0);
      setShowAllRows(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [analysis.rows.length, endDate, metric, place, startDate]);

  const simulations = useMemo(() => {
    if (!analysis.fitted.length) return { outer: quantileBands([]), inner: quantileBands([]) };
    const paths = simulatePoissonPaths(analysis.fitted, simulationCount, seed, true);
    return { outer: quantileBands(paths, 0.05, 0.95), inner: quantileBands(paths, 0.25, 0.75) };
  }, [analysis.fitted, seed, simulationCount]);

  const safeCursor = clamp(cursor, 0, Math.max(0, analysis.rows.length - 1));
  const selected = analysis.rows[safeCursor];
  const activeGuide = GUIDES[guide];
  const selectedModel = analysis.models[model === "homogeneous" ? 0 : 1];
  const alternateModel = analysis.models[model === "homogeneous" ? 1 : 0];
  const aicDelta = alternateModel && selectedModel ? selectedModel.aic - alternateModel.aic : 0;
  const dispersionTone = analysis.dispersion > 2 ? "warn" : analysis.dispersion >= 0.7 && analysis.dispersion <= 1.5 ? "good" : "neutral";

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setStartDate(preset.start); setEndDate(preset.end);
  };

  const shareConfiguration = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setShareStatus("Configuration link copied."); }
    catch { setShareStatus("The configuration is saved in the page URL."); }
  };

  const downloadCsv = () => {
    const header = "date,raw_report,analysis_count,smoothed_intensity,fitted_intensity,cumulative_count,compensator,pearson_residual,correction_day";
    const body = analysis.rows.map((row) => [row.date, row.raw, row.count, row.smoothed.toFixed(4), row.fitted.toFixed(4), row.cumulative, row.compensator.toFixed(4), row.residual.toFixed(6), row.isCorrection].join(","));
    const blob = new Blob([[header, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `covid-point-process-${place.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${metric}-${startDate}-${endDate}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  };

  if (error) return <ErrorView message={error} retry={() => { setArchive(null); setError(null); setReload((value) => value + 1); }} />;
  if (!archive) return <LoadingView />;

  return (
    <main className={`point-process-lab metric-${metric}`}>
      <a className="skip-link" href="#lab-workspace">Skip to analysis workspace</a>
      <header className="lab-topbar">
        <a className="lab-brand" href="#lab-workspace" aria-label="COVID Point Process Lab, workspace"><span className="lab-logo">λ</span><span><strong>COVID</strong> Point Process Lab</span></a>
        <nav aria-label="Lab sections">
          <button type="button" onClick={() => setTab("observe")}>Lab</button>
          <button type="button" onClick={() => setGuide("counting")}>Concepts</button>
          <button type="button" onClick={() => setTab("data")}>Data & caveats</button>
        </nav>
        <a className="archive-chip" href="https://github.com/nytimes/covid-19-data" target="_blank" rel="noreferrer"><i aria-hidden="true" />NYT archive · through Mar 23, 2023 <span aria-hidden="true">↗</span></a>
      </header>

      <section className="dataset-toolbar" aria-label="Dataset controls">
        <label><span>Outcome</span><select value={metric} onChange={(event) => setMetric(event.target.value as Metric)}><option value="cases">Reported cases</option><option value="deaths">Reported deaths</option></select></label>
        <label className="place-select"><span>Geography</span><select value={place} onChange={(event) => setPlace(event.target.value)}>{archive.places.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Window</span><select value="" onChange={(event) => applyPreset(event.target.value)}><option value="" disabled>Choose preset…</option>{PRESETS.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}</option>)}</select></label>
        <label><span>Start</span><input type="date" min={ARCHIVE_START} max={endDate} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label><span>End</span><input type="date" min={startDate} max={ARCHIVE_END} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        <div className="toolbar-actions"><button type="button" onClick={shareConfiguration}>Share configuration</button><button type="button" onClick={downloadCsv}>Download analysis CSV</button><span aria-live="polite">{shareStatus}</span></div>
      </section>

      <div className="lab-shell">
        <aside className="control-rail" aria-label="Analysis controls">
          <div className="rail-heading"><span>Specification</span><strong>Model the reports</strong></div>
          <fieldset><legend>Correction policy</legend><label className="radio-card"><input type="radio" name="correction" checked={correction === "redistribute-backward"} onChange={() => setCorrection("redistribute-backward")} /><span><strong>Reallocate backward</strong><small>Preserve net total by removing revisions from prior reports.</small></span></label><label className="radio-card"><input type="radio" name="correction" checked={correction === "clamp"} onChange={() => setCorrection("clamp")} /><span><strong>Clamp to zero</strong><small>Sensitivity view; negative days become zero and the total rises.</small></span></label></fieldset>
          <fieldset><legend>Intensity block / smoother</legend><div className="button-group">{[7, 14, 28].map((value) => <button type="button" key={value} className={bandwidth === value ? "is-active" : undefined} aria-pressed={bandwidth === value} onClick={() => setBandwidth(value)}>{value} days</button>)}</div></fieldset>
          <fieldset><legend>Fitted Poisson model</legend><label className="radio-card"><input type="radio" name="model" checked={model === "homogeneous"} onChange={() => setModel("homogeneous")} /><span><strong>Homogeneous</strong><small>One constant μ for the selected window.</small></span></label><label className="radio-card"><input type="radio" name="model" checked={model === "piecewise"} onChange={() => setModel("piecewise")} /><span><strong>Piecewise constant</strong><small>One μ per {bandwidth}-day block.</small></span></label></fieldset>
          <fieldset><legend>Simulation</legend><label className="stacked-field"><span>Replicate paths</span><select value={simulationCount} onChange={(event) => setSimulationCount(Number(event.target.value))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label><label className="stacked-field"><span>Deterministic seed</span><input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value) || 1)} /></label><button className="secondary-action" type="button" onClick={() => setSeed((value) => value + 1)}>Resimulate with seed {seed + 1}</button></fieldset>
          <div className="rail-audit"><span>Data audit</span><strong>{analysis.correctionSummary.negativeDayCount} correction {analysis.correctionSummary.negativeDayCount === 1 ? "day" : "days"}</strong><p>{formatCount(analysis.correctionSummary.totalNegative)} signed reports in this window. The policy is visible because negative counts are not valid Poisson increments.</p></div>
        </aside>

        <section className="lab-workspace" id="lab-workspace">
          <header className="workspace-intro">
            <div><p className="workspace-eyebrow">Daily grouped-count laboratory</p><h1>From reports to a counting process.</h1><p>Observe increments, estimate intensity, fit a baseline, and ask whether the stochastic assumptions survive contact with pandemic reporting.</p></div>
            <div className="notation-card"><span>Observation model</span><code>Yₜ ~ Poisson(μₜ)</code><small>μₜ = ∫<sub>day t</sub> λ(s)ds</small></div>
          </header>

          <div className="metric-strip" aria-label="Current window summary">
            <MetricCard label="Window total · N(T)" value={formatCount(analysis.total)} detail={`${analysis.rows.length} daily intervals`} />
            <MetricCard label="Mean intensity" value={formatCount(analysis.mean)} detail="reports per day" />
            <MetricCard label="Variance ÷ mean" value={formatStat(analysis.dispersion)} detail="Poisson benchmark = 1" tone={dispersionTone} />
            <MetricCard label="Lag-1 residual ACF" value={formatStat(analysis.residualAcf)} detail="Poisson benchmark ≈ 0" tone={Math.abs(analysis.residualAcf) > 0.2 ? "warn" : "good"} />
          </div>

          <div className="lab-tabs" role="tablist" aria-label="Analysis views">{TABS.map((item) => <button type="button" key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "is-active" : undefined} onClick={() => setTab(item.id)}><span>{item.index}</span>{item.label}</button>)}</div>

          <div className="tab-workspace" role="tabpanel">
            {!analysis.rows.length ? <div className="empty-panel"><h2>No reports in this window.</h2><p>Choose a later interval or another geography.</p></div> : null}

            {analysis.rows.length && tab === "observe" ? <>
              <FigurePanel index="01A" title="Daily increments and expected count" subtitle="Bars are analysis-ready Yₜ. The solid line is a centered descriptive smoother; the dashed line is fitted μₜ." legend={<><LegendItem kind="observed">Yₜ</LegendItem><LegendItem kind="smooth">smoother</LegendItem><LegendItem kind="model">fitted μₜ</LegendItem><LegendItem kind="correction">correction</LegendItem></>}><IncrementChart rows={analysis.rows} metric={metric} cursor={safeCursor} onCursor={setCursor} /><figcaption>Raw signed correction days are marked in rust. Hover, drag, or focus the chart and use arrow keys; hold Shift to move one week.</figcaption></FigurePanel>
              <FigurePanel index="01B" title="Counting process and compensator" subtitle="N(t) accumulates adjusted reports. Λ̂(t) accumulates fitted expected counts under the selected model." legend={<><LegendItem kind="observed-line">N(t)</LegendItem><LegendItem kind="model">Λ̂(t)</LegendItem></>}><CumulativeChart rows={analysis.rows} cursor={safeCursor} onCursor={setCursor} /><figcaption>The gap M(t) = N(t) − Λ̂(t) is a cumulative model residual. Persistent drift means the fitted intensity is missing structure.</figcaption></FigurePanel>
              <NearbyTable rows={analysis.rows} cursor={safeCursor} />
            </> : null}

            {analysis.rows.length && tab === "fit" ? <>
              <FigurePanel index="02A" title="Estimate μₜ, the expected reports per day" subtitle={`Current fit: ${model === "homogeneous" ? "one rate across the window" : `one rate per ${bandwidth}-day block`}.`} legend={<><LegendItem kind="observed">Yₜ</LegendItem><LegendItem kind="model">fitted μₜ</LegendItem></>}><IncrementChart rows={analysis.rows} metric={metric} cursor={safeCursor} onCursor={setCursor} /></FigurePanel>
              <section className="model-comparison"><header><div><span>Model comparison</span><h2>Does a changing intensity earn its complexity?</h2></div><code>ℓ = Σ[y log μ − μ − log(y!)]</code></header><div className="table-scroll"><table><thead><tr><th>Model</th><th>Parameters</th><th>Log likelihood</th><th>AIC ↓</th><th>Pearson X²/df</th></tr></thead><tbody>{analysis.models.map((item) => <tr key={item.label} className={item.label === selectedModel?.label ? "is-selected" : undefined}><th>{item.label}{item.label === selectedModel?.label ? <span> selected</span> : null}</th><td>{item.parameters}</td><td>{formatStat(item.logLikelihood, 1)}</td><td>{formatStat(item.aic, 1)}</td><td>{formatStat(item.pearsonRatio)}</td></tr>)}</tbody></table></div><p>{Math.abs(aicDelta) < 2 ? "The two models have similar AIC in this window." : aicDelta > 0 ? `The selected model trails the alternative by ${formatStat(aicDelta, 1)} AIC points.` : `The selected model improves AIC by ${formatStat(-aicDelta, 1)} points.`} AIC compares these fitted descriptions; it does not make the independent-increments assumption true.</p></section>
              <div className="concept-grid"><article><span>HPP</span><h3>Homogeneous process</h3><code>μₜ = λΔ</code><p>Stationary, independent increments with one constant intensity. Useful as a baseline precisely because pandemic waves violate it.</p></article><article><span>NHPP</span><h3>Piecewise intensity</h3><code>μₜ = λⱼΔ, t ∈ block j</code><p>Allows the expected count to change by block. The daily archive identifies interval means—not the intensity inside each day.</p></article><article><span>DESCRIPTIVE</span><h3>Centered smoother</h3><code>λ̂ₜ = mean(Y around t)</code><p>A visual rate estimate. Overlapping averages are correlated and are not treated as independent likelihood observations.</p></article></div>
            </> : null}

            {analysis.rows.length && tab === "simulate" ? <>
              <FigurePanel index="03A" title="Parametric simulation envelope" subtitle={`${simulationCount} reproducible cumulative paths from the selected ${model} Poisson model; seed ${seed}.`} legend={<><LegendItem kind="observed-line">observed N(t)</LegendItem><LegendItem kind="simulation">central 50% / 90%</LegendItem></>}><SimulationChart rows={analysis.rows} outer={simulations.outer} inner={simulations.inner} cursor={safeCursor} onCursor={setCursor} /><figcaption>Simulation asks what paths would look like if fitted μₜ were correct and daily increments were conditionally independent Poisson draws.</figcaption></FigurePanel>
              <div className="simulation-notes"><article><span>READ THE BAND</span><h3>Model criticism, not prediction</h3><p>If the observed path repeatedly escapes a narrow envelope, the fitted rate, variance, or dependence structure is inadequate. This is an in-sample parametric check.</p></article><article><span>SEED · {seed}</span><h3>Reproducible stochastic output</h3><p>Changing the seed generates a different valid Monte Carlo sample without changing the model. Shared URLs retain the seed.</p><button type="button" className="primary-action" onClick={() => setSeed((value) => value + 1)}>Draw another ensemble</button></article><article><span>NOT OBSERVED EVENTS</span><h3>No fabricated event times</h3><p>These paths simulate daily counts only. The NYT archive cannot identify within-day waiting times, so the lab never jitters reports into fake timestamps.</p></article></div>
            </> : null}

            {analysis.rows.length && tab === "diagnose" ? <>
              <FigurePanel index="04A" title="Pearson residual sequence" subtitle="Residuals standardize observed minus expected counts. Runs and structure matter as much as individual extremes." legend={<><LegendItem kind="regular">|rₜ| ≤ 2</LegendItem><LegendItem kind="correction">|rₜ| &gt; 2</LegendItem></>}><ResidualChart rows={analysis.rows} cursor={safeCursor} onCursor={setCursor} /><figcaption>rₜ = (Yₜ − μ̂ₜ) / √μ̂ₜ. The shaded reference band is ±2, not a multiple-testing-adjusted decision boundary.</figcaption></FigurePanel>
              <section className="diagnostic-grid"><MetricCard label="Raw dispersion" value={formatStat(analysis.dispersion)} detail={analysis.dispersion > 1.5 ? "variance exceeds mean" : "near equidispersion"} tone={dispersionTone} /><MetricCard label="Pearson X² / df" value={formatStat(selectedModel?.pearsonRatio ?? Number.NaN)} detail="fitted-model dispersion" tone={(selectedModel?.pearsonRatio ?? 0) > 1.5 ? "warn" : "good"} /><MetricCard label="Residual lag 1" value={formatStat(analysis.residualAcf)} detail={Math.abs(analysis.residualAcf) > 0.2 ? "serial structure remains" : "weak adjacent dependence"} tone={Math.abs(analysis.residualAcf) > 0.2 ? "warn" : "good"} /><MetricCard label="Inside ±2" value={Number.isFinite(analysis.withinTwo) ? `${formatStat(analysis.withinTwo * 100, 1)}%` : "—"} detail="Pearson residuals" /></section>
              <div className="diagnostic-interpretation"><span>DIAGNOSTIC READING</span><h2>{analysis.dispersion > 2 ? "A simple Poisson variance is not enough." : "The dispersion check is comparatively close to Poisson."}</h2><p>{analysis.dispersion > 2 ? "Large variance-to-mean ratios can reflect epidemic nonstationarity, weekday reporting, backlogs, changing observation systems, or genuine latent-rate variation. A negative-binomial or Cox-process extension may absorb overdispersion, but it does not automatically repair serial correlation or a misspecified mean." : "Do not stop at one scalar: inspect residual autocorrelation, correction days, and simulation coverage before accepting the model."}</p></div>
              <NearbyTable rows={analysis.rows} cursor={safeCursor} />
            </> : null}

            {tab === "data" ? <>
              <section className="data-intro"><div><span>CURRENT ANALYSIS SUBSET</span><h2>{place} · reported {metric}</h2><p>{formatDate(startDate)}—{formatDate(endDate)} · {analysis.rows.length} rows · {correction === "redistribute-backward" ? "backward reallocation" : "zero clamp"} sensitivity policy.</p></div><button type="button" className="primary-action" onClick={downloadCsv}>Download analysis CSV</button></section>
              <div className="data-table table-scroll"><table><thead><tr><th>Date</th><th>Raw report</th><th>Analysis Yₜ</th><th>Smoother</th><th>Fitted μₜ</th><th>N(t)</th><th>Λ̂(t)</th><th>Residual</th><th>Audit</th></tr></thead><tbody>{analysis.rows.slice(0, showAllRows ? analysis.rows.length : 100).map((row) => <tr key={row.date}><th>{row.date}</th><td>{integerNumber.format(row.raw)}</td><td>{integerNumber.format(row.count)}</td><td>{formatStat(row.smoothed, 1)}</td><td>{formatStat(row.fitted, 1)}</td><td>{integerNumber.format(row.cumulative)}</td><td>{formatStat(row.compensator, 1)}</td><td>{formatStat(row.residual)}</td><td>{row.isCorrection ? "negative correction" : "—"}</td></tr>)}</tbody></table></div>
              {analysis.rows.length > 100 ? <button type="button" className="show-rows" onClick={() => setShowAllRows((value) => !value)}>{showAllRows ? "Show first 100 rows" : `Show all ${analysis.rows.length} rows`}</button> : null}
              <section className="methods-grid"><article><span>MEASUREMENT</span><h3>Reports are not infection times</h3><p>Daily values are differences of cumulative reported counts. They combine confirmed and probable events announced that day, not cases by onset or deaths by occurrence.</p></article><article><span>INTERVAL COUNTS</span><h3>What the archive identifies</h3><p>The model is Yₜ ~ Poisson(μₜ), where μₜ is integrated intensity over a day. Exact interarrival times and event-time rescaling are unidentified.</p></article><article><span>CORRECTIONS</span><h3>Negative increments are revisions</h3><p>The raw audit preserves their dates. Both analysis policies are sensitivity choices; neither reconstructs when the underlying events truly happened.</p></article><article><span>DEPENDENCE</span><h3>Epidemics violate easy assumptions</h3><p>Contagion, policy, testing, holidays, batching, and backlogs generate nonstationarity and dependence. Hawkes and causal claims require more suitable data and models.</p></article></section>
              <section className="source-panel"><div><span>DATA PROVENANCE</span><h3>The New York Times COVID-19 archive</h3><p>Frozen local snapshots of U.S. and state daily reports, ending March 23, 2023. Counts include confirmed and probable cases and deaths where available.</p></div><div className="source-links"><a href="https://github.com/nytimes/covid-19-data#readme" target="_blank" rel="noreferrer">Dataset README ↗</a><a href="https://github.com/nytimes/covid-19-data/tree/master/rolling-averages" target="_blank" rel="noreferrer">Rolling-average methods ↗</a><a href="https://jmlr.org/papers/v23/21-0917.html" target="_blank" rel="noreferrer">Interval-censored point processes ↗</a></div></section>
            </> : null}
          </div>
        </section>

        <aside className="concept-inspector" aria-label="Live concept inspector">
          <div className="inspector-heading"><span>Live inspector</span><strong>{selected ? formatDate(selected.date) : "Select a day"}</strong></div>
          <section className="day-equation"><code>Yₜ = N(t) − N(t−1)</code><div><span>Raw report</span><strong>{selected ? integerNumber.format(selected.raw) : "—"}</strong></div><div><span>Analysis Yₜ</span><strong>{selected ? integerNumber.format(selected.count) : "—"}</strong></div><div><span>Fitted μₜ</span><strong>{selected ? formatStat(selected.fitted, 1) : "—"}</strong></div><div><span>Cumulative N(t)</span><strong>{selected ? formatCount(selected.cumulative) : "—"}</strong></div><div><span>Compensator Λ̂(t)</span><strong>{selected ? formatCount(selected.compensator) : "—"}</strong></div><div><span>Pearson rₜ</span><strong className={selected && Math.abs(selected.residual) > 2 ? "is-alert" : undefined}>{selected ? formatStat(selected.residual) : "—"}</strong></div>{selected?.isCorrection ? <p className="correction-alert">This date contains a signed reporting correction; the selected policy changes the model input.</p> : null}</section>
          <section className="guide-card"><label><span>Guided exercise</span><select value={guide} onChange={(event) => setGuide(event.target.value as keyof typeof GUIDES)}>{Object.entries(GUIDES).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}</select></label><h2>{activeGuide.title}</h2><p>{activeGuide.text}</p><ol>{activeGuide.steps.map((step) => <li key={step}>{step}</li>)}</ol></section>
          <section className="assumption-card"><span>Point-process checklist</span><ul><li><i className="is-yes" />Integer interval counts</li><li><i className={analysis.correctionSummary.negativeDayCount ? "is-warn" : "is-yes"} />Nonnegative model input</li><li><i className={analysis.dispersion > 1.5 ? "is-warn" : "is-yes"} />Variance ≈ mean</li><li><i className={Math.abs(analysis.residualAcf) > 0.2 ? "is-warn" : "is-yes"} />Weak residual dependence</li><li><i className="is-no" />Exact event times observed</li></ul><p>These are diagnostics, not automatic pass/fail tests.</p></section>
          <details className="keyboard-help"><summary>Keyboard help</summary><p>Focus a chart and use ←/→ for one day, Shift + ←/→ for one week, Home/End for window limits.</p></details>
        </aside>
      </div>

      <footer className="lab-footer"><div className="lab-brand"><span className="lab-logo">λ</span><span><strong>COVID</strong> Point Process Lab</span></div><p>For statistical learning and model criticism—not present-day health guidance, causal inference, or forecasting.</p><a href="https://github.com/nytimes/covid-19-data" target="_blank" rel="noreferrer">Data: The New York Times ↗</a></footer>
    </main>
  );
}

export default CovidAtlas;
