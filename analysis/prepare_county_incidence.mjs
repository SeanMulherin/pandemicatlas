#!/usr/bin/env node

import { createReadStream, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import readline from "node:readline";

const ARCHIVE_START = "2020-01-21";
const ARCHIVE_END = "2023-03-23";
const DAY_MS = 86_400_000;
const FIELD_NAMES = ["casesAvg", "casesAvgPer100k", "deathsAvg", "deathsAvgPer100k"];
const MISSING_VALUE = 255;
const MAX_ENCODED_VALUE = 254;
const CAP_QUANTILE = 0.995;
const SAMPLE_LIMIT = 150_000;
const BINARY_HEADER_BYTES = 16;
const REQUIRED_HEADERS = [
  "date",
  "geoid",
  "cases_avg",
  "cases_avg_per_100k",
  "deaths_avg",
  "deaths_avg_per_100k",
];
const FILE_RANGES = {
  2020: { start: "2020-01-21", end: "2020-12-31", days: 346 },
  2021: { start: "2021-01-01", end: "2021-12-31", days: 365 },
  2022: { start: "2022-01-01", end: "2022-12-31", days: 365 },
  2023: { start: "2023-01-01", end: "2023-03-23", days: 82 },
};

const SPECIAL_REPORTING_AREAS = {
  "36998": {
    label: "New York City (combined reporting area)",
    targets: ["36005", "36047", "36061", "36081", "36085"],
  },
  "02997": {
    label: "Bristol Bay plus Lake and Peninsula (combined reporting area)",
    targets: ["02060", "02164"],
  },
  "02998": {
    label: "Yakutat plus Hoonah-Angoon (combined reporting area)",
    targets: ["02282", "02105"],
  },
};

function parseArguments(argv) {
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith("--") || !argument.includes("=")) continue;
    const separator = argument.indexOf("=");
    values.set(argument.slice(2, separator), argument.slice(separator + 1));
  }
  return {
    countiesDir: values.get("counties-dir"),
    topology: values.get("topology"),
    outputDir: values.get("output-dir") ?? "public/data",
  };
}

function splitCsv(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current);
  return cells;
}

function dateIndex(date) {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${ARCHIVE_START}T00:00:00Z`)) / DAY_MS,
  );
}

function formatCoordinate(value) {
  return Number(value.toFixed(1)).toString();
}

function createTopologyPathBuilder(topology) {
  const { scale, translate } = topology.transform;
  const decodedArcs = topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([deltaX, deltaY]) => {
      x += deltaX;
      y += deltaY;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });

  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const arc of decodedArcs) {
    for (const [x, y] of arc) {
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }

  const padding = 4;
  const shiftX = padding - minimumX;
  const shiftY = padding - minimumY;
  const width = Math.ceil(maximumX - minimumX + padding * 2);
  const height = Math.ceil(maximumY - minimumY + padding * 2);

  function pointsForArc(index) {
    const points = decodedArcs[index < 0 ? ~index : index];
    return index < 0 ? points.toReversed() : points;
  }

  function ringPath(arcIndexes) {
    const points = [];
    arcIndexes.forEach((arcIndex, index) => {
      const arcPoints = pointsForArc(arcIndex);
      points.push(...(index === 0 ? arcPoints : arcPoints.slice(1)));
    });
    if (points.length === 0) return "";
    return points
      .map(([x, y], index) => {
        const command = index === 0 ? "M" : "L";
        return `${command}${formatCoordinate(x + shiftX)},${formatCoordinate(y + shiftY)}`;
      })
      .join("") + "Z";
  }

  function geometryPath(geometry) {
    if (geometry.type === "Polygon") {
      return geometry.arcs.map(ringPath).join("");
    }
    if (geometry.type === "MultiPolygon") {
      return geometry.arcs.flatMap((polygon) => polygon.map(ringPath)).join("");
    }
    return "";
  }

  return { geometryPath, width, height };
}

function seededRandom() {
  let state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function createReservoir() {
  const samples = [];
  let seen = 0;
  const random = seededRandom();
  return {
    add(value) {
      if (!Number.isFinite(value) || value <= 0) return;
      seen += 1;
      if (samples.length < SAMPLE_LIMIT) {
        samples.push(value);
        return;
      }
      const index = Math.floor(random() * seen);
      if (index < SAMPLE_LIMIT) samples[index] = value;
    },
    quantile(probability) {
      if (samples.length === 0) return 1;
      samples.sort((a, b) => a - b);
      return samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * probability))];
    },
    get count() {
      return seen;
    },
  };
}

async function loadRollingSeries({ files, countyIndex, countyCount, dayCount }) {
  const values = new Float32Array(dayCount * countyCount * FIELD_NAMES.length);
  values.fill(Number.NaN);
  const covered = new Set();
  const reportingGroups = new Map();
  const reservoirs = FIELD_NAMES.map(() => createReservoir());
  let mappedRows = 0;
  let excludedRows = 0;
  let targetWrites = 0;
  let missingMappedValues = 0;
  let negativeValuesDisplayedAsZero = 0;
  const allDates = new Set();

  for (const file of files) {
    const input = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    let header;
    let currentDate = "";
    let minimumDate = "";
    let maximumDate = "";
    const fileDates = new Set();
    let sourceFipsToday = new Set();
    for await (const line of input) {
      const cells = splitCsv(line);
      if (!header) {
        header = new Map(cells.map((name, index) => [name, index]));
        const missingHeaders = REQUIRED_HEADERS.filter((name) => !header.has(name));
        if (missingHeaders.length > 0) {
          throw new Error(`${path.basename(file)} is missing columns: ${missingHeaders.join(", ")}`);
        }
        continue;
      }

      const date = cells[header.get("date")];
      if (currentDate && date < currentDate) {
        throw new Error(`${path.basename(file)} is not sorted by date at ${date}`);
      }
      if (date !== currentDate) {
        currentDate = date;
        sourceFipsToday = new Set();
        fileDates.add(date);
        allDates.add(date);
        if (!minimumDate || date < minimumDate) minimumDate = date;
        if (!maximumDate || date > maximumDate) maximumDate = date;
      }
      const sourceFips = cells[header.get("geoid")].replace(/^USA-/, "");
      if (sourceFipsToday.has(sourceFips)) {
        throw new Error(`${path.basename(file)} repeats ${sourceFips} on ${date}`);
      }
      sourceFipsToday.add(sourceFips);
      const day = dateIndex(date);
      if (day < 0 || day >= dayCount) continue;

      const special = SPECIAL_REPORTING_AREAS[sourceFips];
      const targetFips = countyIndex.has(sourceFips)
        ? [sourceFips]
        : special?.targets.filter((fips) => countyIndex.has(fips)) ?? [];
      if (targetFips.length === 0) {
        excludedRows += 1;
        continue;
      }

      const sourceValues = [
        cells[header.get("cases_avg")],
        cells[header.get("cases_avg_per_100k")],
        cells[header.get("deaths_avg")],
        cells[header.get("deaths_avg_per_100k")],
      ].map((cell) => cell === "" ? Number.NaN : Number(cell));
      mappedRows += 1;

      for (const fips of targetFips) {
        const county = countyIndex.get(fips);
        const offset = (day * countyCount + county) * FIELD_NAMES.length;
        sourceValues.forEach((sourceValue, field) => {
          if (!Number.isFinite(sourceValue)) {
            missingMappedValues += 1;
            return;
          }
          if (sourceValue < 0) negativeValuesDisplayedAsZero += 1;
          const value = Math.max(0, sourceValue);
          values[offset + field] = value;
          reservoirs[field].add(value);
        });
        covered.add(county);
        targetWrites += 1;
        if (special) reportingGroups.set(county, special.label);
      }
    }

    const year = Number(path.basename(file).match(/(20\d{2})/)?.[1]);
    const expected = FILE_RANGES[year];
    if (
      !expected
      || minimumDate !== expected.start
      || maximumDate !== expected.end
      || fileDates.size !== expected.days
    ) {
      throw new Error(
        `${path.basename(file)} has ${fileDates.size} dates from ${minimumDate} to ${maximumDate}; `
        + `expected ${expected?.days ?? "the configured number of"} dates from `
        + `${expected?.start ?? "the configured start"} to ${expected?.end ?? "the configured end"}`,
      );
    }
  }

  if (allDates.size !== dayCount || covered.size !== countyCount || missingMappedValues > 0) {
    throw new Error(
      `County input failed completeness checks: ${allDates.size}/${dayCount} dates, `
      + `${covered.size}/${countyCount} mapped counties, ${missingMappedValues} missing mapped cells`,
    );
  }

  let preReportingMissingValues = 0;
  for (let county = 0; county < countyCount; county += 1) {
    let firstReportedDay = -1;
    for (let day = 0; day < dayCount; day += 1) {
      const outputOffset = (day * countyCount + county) * FIELD_NAMES.length;
      const hasRow = Number.isFinite(values[outputOffset]);
      if (firstReportedDay < 0 && hasRow) firstReportedDay = day;
      if (firstReportedDay < 0) {
        preReportingMissingValues += FIELD_NAMES.length;
        continue;
      }
      for (let field = 0; field < FIELD_NAMES.length; field += 1) {
        if (!Number.isFinite(values[outputOffset + field])) {
          throw new Error(
            `Internal reporting gap for ${county} on day ${day}, field ${FIELD_NAMES[field]}`,
          );
        }
      }
    }
  }

  return {
    values,
    reservoirs,
    covered,
    reportingGroups,
    mappedRows,
    excludedRows,
    targetWrites,
    missingMappedValues,
    negativeValuesDisplayedAsZero,
    preReportingMissingValues,
  };
}

function encodeSeries(values, caps) {
  const encoded = new Uint8Array(values.length);
  encoded.fill(MISSING_VALUE);
  for (let offset = 0; offset < values.length; offset += 1) {
    const value = values[offset];
    if (!Number.isFinite(value)) continue;
    if (value <= 0) {
      encoded[offset] = 0;
      continue;
    }
    const cap = caps[offset % FIELD_NAMES.length];
    const ratio = Math.log1p(Math.min(value, cap)) / Math.log1p(cap);
    encoded[offset] = Math.max(1, Math.min(MAX_ENCODED_VALUE, Math.round(ratio * MAX_ENCODED_VALUE)));
  }
  return encoded;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.countiesDir || !options.topology) {
    throw new Error(
      "Usage: node analysis/prepare_county_incidence.mjs "
      + "--counties-dir=/path/to/nyt/rolling-average/files "
      + "--topology=/path/to/counties-albers-10m.json [--output-dir=public/data]",
    );
  }

  const topology = JSON.parse(await fs.readFile(options.topology, "utf8"));
  const countyGeometries = topology.objects.counties.geometries;
  const stateGeometries = topology.objects.states.geometries;
  const nationGeometry = topology.objects.nation.geometries[0];
  const { geometryPath, width, height } = createTopologyPathBuilder(topology);
  const states = new Map(
    stateGeometries.map((geometry) => [String(geometry.id).padStart(2, "0"), geometry.properties.name]),
  );
  const counties = countyGeometries.map((geometry) => {
    const fips = String(geometry.id).padStart(5, "0");
    return {
      fips,
      name: geometry.properties.name,
      state: states.get(fips.slice(0, 2)) ?? "",
      path: geometryPath(geometry),
    };
  });
  const countyIndex = new Map(counties.map((county, index) => [county.fips, index]));
  const dayCount = dateIndex(ARCHIVE_END) + 1;
  const countyCount = counties.length;
  const inputFiles = [2020, 2021, 2022, 2023].map((year) =>
    path.join(options.countiesDir, `us-counties-rolling-${year}.csv`),
  );
  await Promise.all(inputFiles.map((file) => fs.access(file)));

  const series = await loadRollingSeries({
    files: inputFiles,
    countyIndex,
    countyCount,
    dayCount,
  });
  const caps = series.reservoirs.map((reservoir) => reservoir.quantile(CAP_QUANTILE));
  const encoded = encodeSeries(series.values, caps);
  const buildHash = createHash("sha256")
    .update(JSON.stringify({
      coverageStart: ARCHIVE_START,
      coverageEnd: ARCHIVE_END,
      fields: FIELD_NAMES,
      counties: counties.map((county) => county.fips),
    }))
    .update(encoded)
    .digest();
  const buildId = buildHash.subarray(0, BINARY_HEADER_BYTES).toString("hex");
  const binary = Buffer.concat([
    buildHash.subarray(0, BINARY_HEADER_BYTES),
    Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength),
  ]);
  let missingEncodedValues = 0;
  for (const value of encoded) if (value === MISSING_VALUE) missingEncodedValues += 1;
  const reportingGroups = Object.fromEntries(
    [...series.reportingGroups.entries()].map(([index, label]) => [counties[index].fips, label]),
  );
  const metadata = {
    version: 1,
    buildId,
    binaryHeaderBytes: BINARY_HEADER_BYTES,
    binaryBytes: binary.byteLength,
    coverageStart: ARCHIVE_START,
    coverageEnd: ARCHIVE_END,
    dayCount,
    countyCount,
    fields: FIELD_NAMES.map((name, index) => ({
      name,
      cap: Number(caps[index].toFixed(4)),
      capQuantile: CAP_QUANTILE,
      encoding: "log1p-uint8",
    })),
    missingValue: MISSING_VALUE,
    maximumEncodedValue: MAX_ENCODED_VALUE,
    geometry: {
      width,
      height,
      counties,
      stateBordersPath: stateGeometries.map(geometryPath).join(""),
      nationPath: geometryPath(nationGeometry),
    },
    reportingGroups,
    quality: {
      sourceRowsMapped: series.mappedRows,
      sourceRowsExcluded: series.excludedRows,
      targetWrites: series.targetWrites,
      countiesWithData: series.covered.size,
      countiesWithoutData: countyCount - series.covered.size,
      missingSourceValues: series.missingMappedValues,
      preReportingMissingValues: series.preReportingMissingValues,
      missingEncodedValues,
      negativeValuesDisplayedAsZero: series.negativeValuesDisplayedAsZero,
    },
    methodology: {
      metric: "The New York Times published trailing seven-day average",
      denominator: "The New York Times published per-100,000 field, based on population estimates",
      colorDomain: "Fixed log scale across the full archive, capped at the field's 99.5th percentile",
      correctionRule: "Negative published averages are displayed at zero; dates before a county begins reporting are marked No report",
    },
    sources: {
      cases: "https://github.com/nytimes/covid-19-data/tree/master/rolling-averages",
      geometry: "https://github.com/topojson/us-atlas",
    },
  };

  await fs.mkdir(options.outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(options.outputDir, "county-incidence-map.json"), JSON.stringify(metadata)),
    fs.writeFile(path.join(options.outputDir, "county-incidence.bin"), binary),
  ]);

  console.log(JSON.stringify({
    outputDir: options.outputDir,
    dayCount,
    countyCount,
    byteLength: binary.byteLength,
    buildId,
    fields: metadata.fields,
    quality: metadata.quality,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
