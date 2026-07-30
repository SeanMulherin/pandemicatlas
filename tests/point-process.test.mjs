import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../app/pointProcess.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "pointProcess.ts",
  reportDiagnostics: true,
});

assert.deepEqual(
  compiled.diagnostics?.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  ),
  [],
);

const statistics = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
);

function closeTo(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("negative reporting corrections are explicit and total-preserving when possible", () => {
  const redistributed = statistics.sanitizeNegativeCorrections([5, 8, -3, 4]);
  assert.deepEqual(redistributed.cleaned, [5, 5, 0, 4]);
  assert.deepEqual(
    {
      negativeDayCount: redistributed.summary.negativeDayCount,
      totalNegative: redistributed.summary.totalNegative,
      redistributed: redistributed.summary.redistributed,
      unallocated: redistributed.summary.unallocated,
      originalTotal: redistributed.summary.originalTotal,
      cleanedTotal: redistributed.summary.cleanedTotal,
    },
    {
      negativeDayCount: 1,
      totalNegative: 3,
      redistributed: 3,
      unallocated: 0,
      originalTotal: 14,
      cleanedTotal: 14,
    },
  );
  assert.deepEqual(redistributed.summary.corrections[0].affectedPriorIndices, [1]);

  const unresolved = statistics.sanitizeNegativeCorrections([-4, 2, -3]);
  assert.deepEqual(unresolved.cleaned, [0, 0, 0]);
  assert.equal(unresolved.summary.redistributed, 2);
  assert.equal(unresolved.summary.unallocated, 5);

  const clamped = statistics.sanitizeNegativeCorrections(
    [5, -2, 1],
    "clamp",
  );
  assert.deepEqual(clamped.cleaned, [5, 0, 1]);
  assert.equal(clamped.summary.redistributed, 0);
  assert.equal(clamped.summary.unallocated, 2);
});

test("cumulative and intensity estimators use the intended daily exposure", () => {
  assert.deepEqual(statistics.cumulativeCounts([2, 0, 3], 10), [12, 12, 15]);
  assert.deepEqual(
    statistics.centeredMovingAverage([1, 2, 9, 4, 5], 3),
    [1.5, 4, 5, 6, 4.5],
  );

  const estimate = statistics.estimatePiecewiseIntensity([1, 3, 2, 6, 10], 2);
  assert.deepEqual(estimate.intensity, [2, 2, 4, 4, 10]);
  assert.deepEqual(estimate.segments, [
    { start: 0, endExclusive: 2, observed: 4, exposure: 2, intensity: 2 },
    { start: 2, endExclusive: 4, observed: 8, exposure: 2, intensity: 4 },
    { start: 4, endExclusive: 5, observed: 10, exposure: 1, intensity: 10 },
  ]);
});

test("Poisson likelihood, AIC, and Pearson residuals match closed-form values", () => {
  closeTo(statistics.logGamma(6), Math.log(120));
  const logLikelihood = statistics.poissonLogLikelihood([0, 1, 2], 1);
  closeTo(logLikelihood, -3 - Math.log(2));
  closeTo(
    statistics.poissonAic([0, 1, 2], 1, 1),
    2 - 2 * logLikelihood,
  );
  assert.deepEqual(statistics.pearsonResiduals([0, 2, 5], [1, 2, 4]), [
    -1,
    0,
    0.5,
  ]);
  assert.equal(statistics.poissonLogLikelihood([0, 0], 0), 0);
  assert.equal(
    statistics.poissonLogLikelihood([0, 1], [0, 0]),
    Number.NEGATIVE_INFINITY,
  );
});

test("dispersion and lag-one autocorrelation expose non-Poisson structure", () => {
  closeTo(statistics.dispersionIndex([0, 2, 4]), 2);
  closeTo(statistics.lag1Autocorrelation([1, 2, 1, 2]), -0.75);
  assert.ok(Number.isNaN(statistics.dispersionIndex([0, 0, 0])));
  assert.ok(Number.isNaN(statistics.lag1Autocorrelation([3, 3, 3])));
});

test("PMF and histogram helpers align observed and expected frequencies", () => {
  closeTo(statistics.poissonPmf(0, 2), Math.exp(-2));
  closeTo(statistics.poissonPmf(3, 2), (Math.exp(-2) * 8) / 6);
  assert.equal(statistics.poissonPmf(-1, 2), 0);

  const histogram = statistics.integerHistogram([0, 1, 1, 2, 4], 2);
  assert.deepEqual(
    histogram.bins.map(({ count }) => count),
    [1, 2, 1],
  );
  assert.equal(histogram.overflowCount, 1);

  const fitted = statistics.poissonHistogram([0, 1, 1, 2, 4], 1, 2);
  closeTo(fitted.bins[1].expectedCount, 5 * Math.exp(-1));
  closeTo(
    fitted.overflowProbability,
    1 - Math.exp(-1) * (1 + 1 + 0.5),
  );
});

test("seeded Poisson simulation is repeatable and has a plausible mean", () => {
  const intensities = new Array(2_000).fill(4);
  const first = statistics.simulatePoissonPath(intensities, "lesson-seed");
  const repeated = statistics.simulatePoissonPath(intensities, "lesson-seed");
  const different = statistics.simulatePoissonPath(intensities, "other-seed");
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, different);
  closeTo(
    first.reduce((total, value) => total + value, 0) / first.length,
    4,
    0.2,
  );

  const cumulative = statistics.simulatePoissonPath([0, 0, 0], 4, true);
  assert.deepEqual(cumulative, [0, 0, 0]);
});

test("quantile bands are computed pointwise over simulated paths", () => {
  const bands = statistics.quantileBands(
    [
      [0, 10],
      [2, 20],
      [4, 30],
    ],
    0.25,
    0.75,
  );
  assert.deepEqual(bands.lower, [1, 15]);
  assert.deepEqual(bands.median, [2, 20]);
  assert.deepEqual(bands.upper, [3, 25]);
  assert.equal(bands.lowerProbability, 0.25);
  assert.equal(bands.upperProbability, 0.75);
});
