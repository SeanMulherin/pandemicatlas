/**
 * Pure utilities for treating grouped daily reports as point-process counts.
 *
 * All rates are expressed as expected events per observation interval (one day
 * for the COVID data). Nothing in this module depends on React or the DOM, so
 * the same calculations can be used by charts, lessons, and tests.
 */

export type Seed = number | string;
export type RandomSource = () => number;
export type NegativeCorrectionStrategy = "redistribute-backward" | "clamp";

export interface NegativeCorrection {
  index: number;
  amount: number;
  redistributed: number;
  unallocated: number;
  affectedPriorIndices: number[];
}

export interface CorrectionSummary {
  strategy: NegativeCorrectionStrategy;
  negativeDayCount: number;
  totalNegative: number;
  redistributed: number;
  unallocated: number;
  originalTotal: number;
  cleanedTotal: number;
  corrections: NegativeCorrection[];
}

export interface SanitizedCounts {
  cleaned: number[];
  summary: CorrectionSummary;
}

export interface IntensitySegment {
  start: number;
  endExclusive: number;
  observed: number;
  exposure: number;
  intensity: number;
}

export interface PiecewiseIntensityEstimate {
  intensity: number[];
  segments: IntensitySegment[];
}

export interface PmfPoint {
  k: number;
  probability: number;
}

export interface HistogramBin {
  k: number;
  count: number;
  proportion: number;
}

export interface IntegerHistogram {
  bins: HistogramBin[];
  overflowCount: number;
  sampleSize: number;
}

export interface PoissonHistogramBin extends HistogramBin {
  probability: number;
  expectedCount: number;
}

export interface PoissonHistogram {
  lambda: number;
  bins: PoissonHistogramBin[];
  overflowCount: number;
  overflowProbability: number;
  expectedOverflowCount: number;
  sampleSize: number;
}

export interface QuantileBands {
  lower: number[];
  median: number[];
  upper: number[];
  lowerProbability: number;
  upperProbability: number;
}

function assertFiniteSeries(values: readonly number[], label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      throw new TypeError(`${label}[${index}] must be a finite number`);
    }
  }
}

function assertNonnegativeSeries(values: readonly number[], label: string): void {
  assertFiniteSeries(values, label);
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] < 0) {
      throw new RangeError(`${label}[${index}] must be nonnegative`);
    }
  }
}

function assertCounts(values: readonly number[], label: string): void {
  assertNonnegativeSeries(values, label);
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isInteger(values[index])) {
      throw new RangeError(`${label}[${index}] must be a whole event count`);
    }
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

/**
 * Removes impossible negative event counts.
 *
 * The default strategy walks backward from each correction and removes the
 * same number of previously reported events. This preserves the signed total
 * whenever enough earlier events exist. `clamp` simply replaces negative days
 * with zero and reports the discarded amount as unallocated.
 */
export function sanitizeNegativeCorrections(
  counts: readonly number[],
  strategy: NegativeCorrectionStrategy = "redistribute-backward",
): SanitizedCounts {
  assertFiniteSeries(counts, "counts");
  if (strategy !== "redistribute-backward" && strategy !== "clamp") {
    throw new RangeError(`Unknown correction strategy: ${String(strategy)}`);
  }

  const cleaned = counts.map((value) => (value < 0 ? 0 : value));
  const corrections: NegativeCorrection[] = [];

  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] >= 0) continue;

    const amount = -counts[index];
    let remaining = amount;
    const affectedPriorIndices: number[] = [];

    if (strategy === "redistribute-backward") {
      for (let prior = index - 1; prior >= 0 && remaining > 0; prior -= 1) {
        const removed = Math.min(cleaned[prior], remaining);
        if (removed <= 0) continue;
        cleaned[prior] -= removed;
        remaining -= removed;
        affectedPriorIndices.push(prior);
      }
    }

    corrections.push({
      index,
      amount,
      redistributed: amount - remaining,
      unallocated: remaining,
      affectedPriorIndices,
    });
  }

  const sum = (values: readonly number[]) =>
    values.reduce((total, value) => total + value, 0);
  const totalNegative = corrections.reduce(
    (total, correction) => total + correction.amount,
    0,
  );
  const redistributed = corrections.reduce(
    (total, correction) => total + correction.redistributed,
    0,
  );

  return {
    cleaned,
    summary: {
      strategy,
      negativeDayCount: corrections.length,
      totalNegative,
      redistributed,
      unallocated: totalNegative - redistributed,
      originalTotal: sum(counts),
      cleanedTotal: sum(cleaned),
      corrections,
    },
  };
}

/** Running total with the same length as the input series. */
export function cumulativeCounts(
  counts: readonly number[],
  initialValue = 0,
): number[] {
  assertFiniteSeries(counts, "counts");
  if (!Number.isFinite(initialValue)) {
    throw new TypeError("initialValue must be finite");
  }

  let total = initialValue;
  return counts.map((count) => {
    total += count;
    return total;
  });
}

/**
 * A centered, edge-aware moving average. At the first and last observations,
 * the denominator shrinks to the number of available days. For even windows,
 * the extra observation lies to the right of the focal day.
 */
export function centeredMovingAverage(
  counts: readonly number[],
  windowSize: number,
): number[] {
  assertFiniteSeries(counts, "counts");
  assertPositiveInteger(windowSize, "windowSize");
  if (counts.length === 0) return [];

  const left = Math.floor((windowSize - 1) / 2);
  const right = windowSize - left - 1;
  const prefix = new Array<number>(counts.length + 1).fill(0);

  for (let index = 0; index < counts.length; index += 1) {
    prefix[index + 1] = prefix[index] + counts[index];
  }

  return counts.map((_, index) => {
    const start = Math.max(0, index - left);
    const endExclusive = Math.min(counts.length, index + right + 1);
    return (prefix[endExclusive] - prefix[start]) / (endExclusive - start);
  });
}

/**
 * Maximum-likelihood piecewise-constant Poisson intensity in fixed-width bins.
 * The last segment uses its actual (possibly shorter) exposure.
 */
export function estimatePiecewiseIntensity(
  counts: readonly number[],
  binWidth: number,
): PiecewiseIntensityEstimate {
  assertNonnegativeSeries(counts, "counts");
  assertPositiveInteger(binWidth, "binWidth");

  const intensity = new Array<number>(counts.length);
  const segments: IntensitySegment[] = [];

  for (let start = 0; start < counts.length; start += binWidth) {
    const endExclusive = Math.min(counts.length, start + binWidth);
    let observed = 0;
    for (let index = start; index < endExclusive; index += 1) {
      observed += counts[index];
    }
    const exposure = endExclusive - start;
    const rate = observed / exposure;
    intensity.fill(rate, start, endExclusive);
    segments.push({
      start,
      endExclusive,
      observed,
      exposure,
      intensity: rate,
    });
  }

  return { intensity, segments };
}

/** Lanczos approximation of log Γ(z), accurate for positive real z. */
export function logGamma(z: number): number {
  if (!Number.isFinite(z) || z <= 0) {
    throw new RangeError("z must be a positive finite number");
  }

  const coefficients = [
    0.9999999999998099,
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }

  const shifted = z - 1;
  let series = coefficients[0];
  for (let index = 1; index < coefficients.length; index += 1) {
    series += coefficients[index] / (shifted + index);
  }
  const t = shifted + coefficients.length - 1.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(t) -
    t +
    Math.log(series)
  );
}

function expandIntensity(
  intensity: number | readonly number[],
  length: number,
): number[] {
  const expanded =
    typeof intensity === "number"
      ? new Array<number>(length).fill(intensity)
      : Array.from(intensity);
  if (expanded.length !== length) {
    throw new RangeError("intensity must have the same length as observed");
  }
  assertNonnegativeSeries(expanded, "intensity");
  return expanded;
}

/** Log-likelihood for independent Poisson interval counts. */
export function poissonLogLikelihood(
  observed: readonly number[],
  intensity: number | readonly number[],
): number {
  assertCounts(observed, "observed");
  const expected = expandIntensity(intensity, observed.length);
  let result = 0;

  for (let index = 0; index < observed.length; index += 1) {
    const count = observed[index];
    const lambda = expected[index];
    if (lambda === 0) {
      if (count > 0) return Number.NEGATIVE_INFINITY;
      continue;
    }
    result += count * Math.log(lambda) - lambda - logGamma(count + 1);
  }
  return result;
}

/** Akaike information criterion: smaller values indicate less expected loss. */
export function akaikeInformationCriterion(
  logLikelihood: number,
  parameterCount: number,
): number {
  if (Number.isNaN(logLikelihood) || logLikelihood === Number.POSITIVE_INFINITY) {
    throw new RangeError("logLikelihood must be finite or negative infinity");
  }
  if (!Number.isInteger(parameterCount) || parameterCount < 0) {
    throw new RangeError("parameterCount must be a nonnegative integer");
  }
  return 2 * parameterCount - 2 * logLikelihood;
}

/** Convenience wrapper for a Poisson model's AIC. */
export function poissonAic(
  observed: readonly number[],
  intensity: number | readonly number[],
  parameterCount: number,
): number {
  return akaikeInformationCriterion(
    poissonLogLikelihood(observed, intensity),
    parameterCount,
  );
}

/** Pearson residuals `(observed - expected) / sqrt(expected)`. */
export function pearsonResiduals(
  observed: readonly number[],
  intensity: number | readonly number[],
): number[] {
  assertCounts(observed, "observed");
  const expected = expandIntensity(intensity, observed.length);
  return observed.map((count, index) => {
    const lambda = expected[index];
    if (lambda === 0) {
      return count === 0 ? 0 : Number.POSITIVE_INFINITY;
    }
    return (count - lambda) / Math.sqrt(lambda);
  });
}

/** Sample variance divided by sample mean; Poisson data should be near one. */
export function dispersionIndex(counts: readonly number[]): number {
  assertNonnegativeSeries(counts, "counts");
  if (counts.length < 2) return Number.NaN;
  const mean = counts.reduce((total, value) => total + value, 0) / counts.length;
  if (mean === 0) return Number.NaN;
  const squaredDeviations = counts.reduce(
    (total, value) => total + (value - mean) ** 2,
    0,
  );
  return squaredDeviations / (counts.length - 1) / mean;
}

/** Conventional sample autocorrelation function evaluated at lag one. */
export function lag1Autocorrelation(counts: readonly number[]): number {
  assertFiniteSeries(counts, "counts");
  if (counts.length < 2) return Number.NaN;
  const mean = counts.reduce((total, value) => total + value, 0) / counts.length;
  let numerator = 0;
  let denominator = 0;

  for (let index = 0; index < counts.length; index += 1) {
    const centered = counts[index] - mean;
    denominator += centered * centered;
    if (index > 0) numerator += centered * (counts[index - 1] - mean);
  }
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

/** Probability of observing exactly k events under Poisson(lambda). */
export function poissonPmf(k: number, lambda: number): number {
  if (!Number.isFinite(lambda) || lambda < 0) {
    throw new RangeError("lambda must be a nonnegative finite number");
  }
  if (!Number.isInteger(k) || k < 0) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - logGamma(k + 1));
}

/** PMF points from zero through maximumK, inclusive. */
export function poissonPmfSeries(
  lambda: number,
  maximumK = Math.max(10, Math.ceil(lambda + 6 * Math.sqrt(lambda + 1))),
): PmfPoint[] {
  if (!Number.isFinite(lambda) || lambda < 0) {
    throw new RangeError("lambda must be a nonnegative finite number");
  }
  if (!Number.isInteger(maximumK) || maximumK < 0) {
    throw new RangeError("maximumK must be a nonnegative integer");
  }
  return Array.from({ length: maximumK + 1 }, (_, k) => ({
    k,
    probability: poissonPmf(k, lambda),
  }));
}

/** Integer-frequency histogram with all values above maximumK in overflow. */
export function integerHistogram(
  samples: readonly number[],
  maximumK = samples.length === 0 ? 0 : Math.max(...samples),
): IntegerHistogram {
  assertCounts(samples, "samples");
  if (!Number.isInteger(maximumK) || maximumK < 0) {
    throw new RangeError("maximumK must be a nonnegative integer");
  }

  const counts = new Array<number>(maximumK + 1).fill(0);
  let overflowCount = 0;
  for (const sample of samples) {
    if (sample > maximumK) overflowCount += 1;
    else counts[sample] += 1;
  }

  return {
    bins: counts.map((count, k) => ({
      k,
      count,
      proportion: samples.length === 0 ? 0 : count / samples.length,
    })),
    overflowCount,
    sampleSize: samples.length,
  };
}

/** Observed histogram augmented with its fitted Poisson expectation. */
export function poissonHistogram(
  samples: readonly number[],
  lambda: number,
  maximumK = samples.length === 0 ? 0 : Math.max(...samples),
): PoissonHistogram {
  if (!Number.isFinite(lambda) || lambda < 0) {
    throw new RangeError("lambda must be a nonnegative finite number");
  }
  const observed = integerHistogram(samples, maximumK);
  let coveredProbability = 0;
  const bins = observed.bins.map((bin) => {
    const probability = poissonPmf(bin.k, lambda);
    coveredProbability += probability;
    return {
      ...bin,
      probability,
      expectedCount: probability * observed.sampleSize,
    };
  });
  const overflowProbability = Math.max(0, 1 - coveredProbability);

  return {
    lambda,
    bins,
    overflowCount: observed.overflowCount,
    overflowProbability,
    expectedOverflowCount: overflowProbability * observed.sampleSize,
    sampleSize: observed.sampleSize,
  };
}

function hashString(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Small deterministic PRNG (Mulberry32), useful for reproducible lessons. */
export function createSeededRandom(seed: Seed = 1): RandomSource {
  let state =
    typeof seed === "string"
      ? hashString(seed)
      : Number.isFinite(seed)
        ? Math.trunc(seed) >>> 0
        : 1;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw one Poisson variate using Knuth or transformed rejection. */
export function samplePoisson(
  lambda: number,
  random: RandomSource = Math.random,
): number {
  if (!Number.isFinite(lambda) || lambda < 0) {
    throw new RangeError("lambda must be a nonnegative finite number");
  }
  if (lambda === 0) return 0;

  if (lambda < 30) {
    const threshold = Math.exp(-lambda);
    let product = 1;
    let count = 0;
    do {
      count += 1;
      product *= random();
    } while (product > threshold);
    return count - 1;
  }

  // Atkinson's transformed-rejection method; unlike a normal approximation,
  // it remains an exact integer-valued Poisson draw for large intensities.
  const c = 0.767 - 3.36 / lambda;
  const beta = Math.PI / Math.sqrt(3 * lambda);
  const alpha = beta * lambda;
  const rejectionConstant = Math.log(c) - lambda - Math.log(beta);

  for (;;) {
    const u = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, random()));
    const x = (alpha - Math.log((1 - u) / u)) / beta;
    const candidate = Math.floor(x + 0.5);
    if (candidate < 0) continue;
    const v = Math.max(Number.MIN_VALUE, random());
    const y = alpha - beta * x;
    const logAcceptance =
      y + Math.log(v) - 2 * Math.log1p(Math.exp(y));
    const logTarget =
      rejectionConstant +
      candidate * Math.log(lambda) -
      logGamma(candidate + 1);
    if (logAcceptance <= logTarget) return candidate;
  }
}

/** Simulate one independent-increments path, optionally as cumulative events. */
export function simulatePoissonPath(
  intensity: readonly number[],
  seed: Seed = 1,
  cumulative = false,
): number[] {
  assertNonnegativeSeries(intensity, "intensity");
  const random = createSeededRandom(seed);
  let total = 0;
  return intensity.map((lambda) => {
    const draw = samplePoisson(lambda, random);
    if (!cumulative) return draw;
    total += draw;
    return total;
  });
}

/** Simulate several paths from one deterministic random stream. */
export function simulatePoissonPaths(
  intensity: readonly number[],
  pathCount: number,
  seed: Seed = 1,
  cumulative = false,
): number[][] {
  assertNonnegativeSeries(intensity, "intensity");
  if (!Number.isInteger(pathCount) || pathCount < 0) {
    throw new RangeError("pathCount must be a nonnegative integer");
  }
  const random = createSeededRandom(seed);
  return Array.from({ length: pathCount }, () => {
    let total = 0;
    return intensity.map((lambda) => {
      const draw = samplePoisson(lambda, random);
      if (!cumulative) return draw;
      total += draw;
      return total;
    });
  });
}

/** Type-7 linearly interpolated sample quantile (the common default). */
export function quantile(values: readonly number[], probability: number): number {
  assertFiniteSeries(values, "values");
  if (values.length === 0) return Number.NaN;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("probability must be between zero and one");
  }
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return ordered[lower] + fraction * (ordered[Math.min(lower + 1, ordered.length - 1)] - ordered[lower]);
}

/** Pointwise lower, median, and upper bands across equal-length paths. */
export function quantileBands(
  paths: readonly (readonly number[])[],
  lowerProbability = 0.025,
  upperProbability = 0.975,
): QuantileBands {
  if (
    !Number.isFinite(lowerProbability) ||
    !Number.isFinite(upperProbability) ||
    lowerProbability < 0 ||
    upperProbability > 1 ||
    lowerProbability > upperProbability
  ) {
    throw new RangeError(
      "quantile probabilities must satisfy 0 <= lower <= upper <= 1",
    );
  }
  if (paths.length === 0) {
    return {
      lower: [],
      median: [],
      upper: [],
      lowerProbability,
      upperProbability,
    };
  }

  const length = paths[0].length;
  paths.forEach((path, pathIndex) => {
    assertFiniteSeries(path, `paths[${pathIndex}]`);
    if (path.length !== length) {
      throw new RangeError("all simulated paths must have the same length");
    }
  });

  const lower: number[] = [];
  const median: number[] = [];
  const upper: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const values = paths.map((path) => path[index]);
    lower.push(quantile(values, lowerProbability));
    median.push(quantile(values, 0.5));
    upper.push(quantile(values, upperProbability));
  }

  return {
    lower,
    median,
    upper,
    lowerProbability,
    upperProbability,
  };
}
