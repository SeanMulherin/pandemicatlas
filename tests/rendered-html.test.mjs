import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished Pandemic Atlas shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>The Pandemic Atlas<\/title>/i);
  assert.match(html, /Trace U\.S\. COVID-19 cases and deaths/i);
  assert.match(html, /\/og\.png/);
  assert.match(html, /Exploring the US COVID-19 Pandemic/);
  assert.match(html, /A visual record of COVID-19 in the United States/);
  assert.match(html, /1,158 days/);
  assert.match(html, /103\.9M/);
  assert.match(html, /1\.1M/);
  assert.doesNotMatch(html, /Preparing 63,000\+ daily records|Rebuilding the pandemic, day by day/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Starter Project/i);
});

test("ships the complete local archive and bespoke preview assets", async () => {
  const [
    national,
    states,
    mobilityRaw,
    mobilityDynamicsRaw,
    mobilityWeekly,
    countyMetadataRaw,
    countyValues,
    socialCard,
    packageJson,
    page,
    layout,
    atlas,
    styles,
    countyMap,
    mobilityAtlas,
    mobilityStory,
    mobilityBuild,
    countyBuild,
  ] = await Promise.all([
    readFile(new URL("../public/data/us.csv", import.meta.url), "utf8"),
    readFile(new URL("../public/data/us-states.csv", import.meta.url), "utf8"),
    readFile(new URL("../public/data/mobility.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/mobility-dynamics.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/mobility-weekly.bin", import.meta.url)),
    readFile(new URL("../public/data/county-incidence-map.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/county-incidence.bin", import.meta.url)),
    readFile(new URL("../public/og.png", import.meta.url)),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/CovidAtlas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/CountyIncidenceMap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/MobilityAtlas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/MobilityStory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../analysis/prepare_kang_mobility_all.R", import.meta.url), "utf8"),
    readFile(new URL("../analysis/prepare_county_incidence.mjs", import.meta.url), "utf8"),
  ]);
  const mobility = JSON.parse(mobilityRaw);
  const mobilityDynamics = JSON.parse(mobilityDynamicsRaw);
  const countyMetadata = JSON.parse(countyMetadataRaw);
  const firstCssRule = (selector, source = styles) => {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  };
  const cssBlockAfter = (source, marker) => {
    const markerAt = source.indexOf(marker);
    assert.notEqual(markerAt, -1);
    const openingBrace = source.indexOf("{", markerAt);
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}" && --depth === 0) {
        return source.slice(openingBrace + 1, index);
      }
    }
    assert.fail(`Unclosed CSS block: ${marker}`);
  };
  const headerRule = firstCssRule(".site-header");
  const explorerControlsRule = firstCssRule(".explorer-controls");
  const mobilityControlsRule = firstCssRule(".mobility-control-desk");
  const htmlRule = firstCssRule("html");
  const baseMobilitySectionTitleRule = firstCssRule(
    ".mobility-section-heading .section-heading-copy h2",
  );
  const baseMobilityFigureTitleRule = firstCssRule(".mobility-figure-heading h3");
  const wideMobilityCss = cssBlockAfter(styles, "@media (min-width: 50.01rem)");

  assert.match(national, /^date,geoid,cases,cases_avg,cases_avg_per_100k/);
  assert.match(states, /^date,geoid,state,cases,cases_avg,cases_avg_per_100k/);
  assert.ok(national.split("\n").length >= 1_158);
  assert.ok(states.split("\n").length >= 61_942);
  assert.equal(socialCard.readUInt32BE(16), 1731);
  assert.equal(socialCard.readUInt32BE(20), 909);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(headerRule, /position:\s*relative/);
  assert.doesNotMatch(headerRule, /position:\s*sticky|top:\s*0/);
  assert.match(explorerControlsRule, /position:\s*sticky/);
  assert.match(explorerControlsRule, /top:\s*0/);
  assert.match(mobilityControlsRule, /position:\s*sticky/);
  assert.match(mobilityControlsRule, /top:\s*0/);
  assert.match(htmlRule, /scroll-padding-top:\s*10rem/);
  assert.match(page, /<CovidAtlas \/>/);
  assert.match(layout, /generateMetadata/);
  assert.match(atlas, /Exploring the US COVID-19 Pandemic/);
  assert.match(atlas, /href="https:\/\/seanmulherin\.github\.io\/">Home<\/a>/);
  assert.match(atlas, /Nationwide Incidence/);
  assert.match(atlas, /Statewide Incidence/);
  assert.match(atlas, /<h2 className="states-title">Statewide Incidence<\/h2>/);
  assert.match(atlas, /<h2 className="analysis-title">Statewide Waves<\/h2>/);
  assert.match(atlas, /Select the states you wish to highlight for evaluation/);
  assert.match(atlas, /Choose up to ten state tiles/);
  assert.match(atlas, /MAX_SELECTED_STATES = 10/);
  assert.match(atlas, /Statewide Rankings/);
  assert.match(atlas, /<CountyIncidenceMap/);
  assert.match(atlas, /<MobilityAtlas covidSeries=\{data\.national\} covidMetric=\{metric\} \/>/);
  assert.doesNotMatch(atlas, /Burden ranks states by the active metric and view/);
  assert.doesNotMatch(atlas, /floating-playback|is-handoff-hidden|pendingHandoffFocusRef|showFloatingPlayback|timeConsoleRef/);
  assert.ok(atlas.indexOf('className="explorer-controls"') < atlas.indexOf('className="time-console"'));
  assert.ok(atlas.indexOf('className="time-console"') < atlas.indexOf('id="pulse"'));
  assert.equal(atlas.match(/aria-label="Date animation controls"/g)?.length, 1);
  assert.equal(atlas.match(/className="play-button"/g)?.length, 1);
  assert.equal(atlas.match(/type="range"/g)?.length, 1);
  assert.doesNotMatch(atlas, /aria-orientation="vertical"/);
  assert.equal(
    atlas.match(/onChange=\{\(event\) => changeCursor\(Number\(event\.target\.value\)\)\}/g)?.length,
    1,
  );
  assert.match(styles, /\.explorer-controls > \.time-console \{[\s\S]*?grid-column: 1 \/ -1;/);
  assert.match(styles, /\.time-console \{[\s\S]*?grid-template-columns:/);
  assert.doesNotMatch(styles, /\.time-console-slot|\.time-console\.is-floating|\.floating-playback|\.time-console\.is-handoff-hidden/);
  assert.doesNotMatch(styles, /writing-mode: vertical-lr|cursor: ns-resize/);
  assert.match(styles, /\.date-slider-wrap input\[type="range"\] \{[\s\S]*?cursor: ew-resize;/);
  assert.ok(
    atlas.indexOf('<h2 className="states-title">Statewide Incidence</h2>')
      < atlas.indexOf('<h2 className="analysis-title">Statewide Waves</h2>'),
  );
  assert.match(atlas, /Kang county traveler totals/);
  assert.match(atlas, /01 \/ Sources/);
  assert.match(atlas, /all 156 official weekly county files/);
  assert.match(atlas, /January 7, 2019 through January 2, 2022/);
  assert.match(atlas, /cumulative movements, not unique/);
  assert.match(atlas, /NYT repository/);
  assert.match(atlas, /Kang repository/);
  assert.match(atlas, /Kang methodology/);
  assert.match(atlas, /County geometry/);
  assert.match(atlas, /https:\/\/github\.com\/GeoDS\/COVID19USFlows-WeeklyFlows/);
  assert.match(atlas, /https:\/\/doi\.org\/10\.1038\/s41597-020-00734-5/);
  assert.match(atlas, /https:\/\/github\.com\/topojson\/us-atlas/);
  assert.doesNotMatch(
    atlas,
    /Dynamic Statewide Incidence|Dynamic Temporal View Grouped by State|Daily ranking|Where the reported burden was highest/,
  );
  assert.match(atlas, /<h1>1,158 days<\/h1>/);
  assert.doesNotMatch(
    atlas,
    /that changed America|One national story, 51 local realities|Trace every reported wave|Explore the record|View source data/,
  );
  assert.doesNotMatch(
    atlas,
    /NYT DATA \/ 2020—2023|Every wave left a different silhouette|Watch the wave move|Reading the map|No two outbreaks moved in lockstep|51 wave fingerprints|Before you interpret the lines/,
  );
  assert.doesNotMatch(atlas, /id="fingerprints"|MiniWaveCanvas|fingerprintSeries/);
  assert.ok(atlas.indexOf("Statewide Rankings") < atlas.indexOf("<CountyIncidenceMap"));
  assert.ok(atlas.indexOf("<CountyIncidenceMap") < atlas.indexOf("<MobilityAtlas covidSeries"));
  assert.match(countyMap, /Countywide Incidence/);
  assert.match(countyMap, /Darker blue indicates higher incidence/);
  assert.match(countyMap, /county-incidence-map\.json/);
  assert.match(countyMap, /county-incidence\.bin/);
  assert.match(countyMap, /selectedDate/);
  assert.match(countyMap, /maximumEncodedValue/);
  assert.match(countyMap, /No report/);
  assert.match(countyMap, /highestValue > 0 \? highestIndex : null/);
  assert.match(countyMap, /!isPlaying && selectedCounty !== null/);
  assert.match(countyBuild, /CAP_QUANTILE = 0\.995/);
  assert.match(countyBuild, /SPECIAL_REPORTING_AREAS/);
  assert.match(countyBuild, /Internal reporting gap/);
  assert.equal(countyMetadata.coverageStart, "2020-01-21");
  assert.equal(countyMetadata.coverageEnd, "2023-03-23");
  assert.equal(countyMetadata.dayCount, 1_158);
  assert.equal(countyMetadata.countyCount, 3_142);
  assert.equal(countyMetadata.geometry.counties.length, 3_142);
  assert.equal(countyMetadata.fields.length, 4);
  assert.equal(countyMetadata.quality.countiesWithoutData, 0);
  assert.equal(countyMetadata.quality.missingSourceValues, 0);
  assert.ok(countyMetadata.quality.missingEncodedValues > 0);
  assert.equal(countyValues.byteLength, countyMetadata.binaryBytes);
  assert.equal(
    countyValues.byteLength,
    countyMetadata.binaryHeaderBytes + (1_158 * 3_142 * 4),
  );
  assert.equal(
    countyValues.subarray(0, countyMetadata.binaryHeaderBytes).toString("hex"),
    countyMetadata.buildId,
  );

  const countyPayload = countyValues.subarray(countyMetadata.binaryHeaderBytes);
  const snohomishIndex = countyMetadata.geometry.counties.findIndex(
    (county) => county.fips === "53061",
  );
  const mohaveIndex = countyMetadata.geometry.counties.findIndex(
    (county) => county.fips === "04015",
  );
  const losAngelesIndex = countyMetadata.geometry.counties.findIndex(
    (county) => county.fips === "06037",
  );
  assert.ok(snohomishIndex >= 0 && mohaveIndex >= 0 && losAngelesIndex >= 0);
  const encodedIndex = (day, county, field) => ((day * 3_142 + county) * 4) + field;
  const expectedFirstSnohomishCases = Math.max(
    1,
    Math.round(
      (Math.log1p(0.14) / Math.log1p(countyMetadata.fields[0].cap))
      * countyMetadata.maximumEncodedValue,
    ),
  );
  assert.equal(
    countyPayload[encodedIndex(0, snohomishIndex, 0)],
    expectedFirstSnohomishCases,
  );
  assert.equal(
    countyPayload[encodedIndex(0, mohaveIndex, 0)],
    countyMetadata.missingValue,
  );
  assert.notEqual(
    countyPayload[encodedIndex(1_157, losAngelesIndex, 0)],
    countyMetadata.missingValue,
  );
  assert.match(mobilityAtlas, /Human Mobility Patterns/);
  assert.match(mobilityAtlas, /We define human mobility/);
  assert.match(mobilityAtlas, /all modes of/);
  assert.match(mobilityAtlas, /Data represent ~10%/);
  assert.match(mobilityAtlas, /daily county release ends Apr\. 15, 2021/);
  assert.match(mobilityAtlas, /weekly county release continues/);
  assert.match(mobilityAtlas, /Where state borders were most porous/);
  assert.match(mobilityAtlas, /Which counties pulled travel in—or pushed it out/);
  assert.match(mobilityAtlas, /<MobilityStory/);
  assert.ok(
    mobilityAtlas.indexOf("Which counties pulled travel in—or pushed it out")
      < mobilityAtlas.indexOf('className="mobility-control-desk"'),
  );
  assert.ok(
    mobilityAtlas.indexOf('className="mobility-control-desk"')
      < mobilityAtlas.indexOf("<MobilityStory"),
  );
  assert.match(mobilityAtlas, /not unique individuals/);
  assert.doesNotMatch(mobilityAtlas, /05<\/span> Human mobility|01 \/ Interstate network|02 \/ County hubs/);
  const mobilityStoryTitles = [
    "Animated County Flow Map",
    "County Mobility Spotlight",
    "Mobility–Incidence Lag Explorer",
  ];
  assert.doesNotMatch(
    mobilityStory,
    /National Mobility Pulse|NationalMobilityPulse|mobility-pulse-|mobility-scope-controls/,
  );
  assert.doesNotMatch(styles, /\.mobility-pulse-(?:grid|canvas)\b|\.mobility-scope-controls\b/);
  mobilityStoryTitles.forEach((title) => assert.match(mobilityStory, new RegExp(title)));
  mobilityStoryTitles.slice(1).forEach((title, index) => {
    assert.ok(mobilityStory.indexOf(mobilityStoryTitles[index]) < mobilityStory.indexOf(title));
  });
  assert.equal(mobilityStory.match(/aria-label="Weekly mobility animation controls"/g)?.length, 1);
  assert.match(mobilityStory, /createPortal/);
  assert.match(mobilityStory, /timelineHost/);
  assert.equal(mobilityAtlas.match(/className="mobility-control-desk"/g)?.length, 1);
  assert.equal(
    mobilityAtlas.match(/className="mobility-timeline-slot" ref=\{setTimelineHost\}/g)?.length,
    1,
  );
  assert.ok(
    mobilityAtlas.indexOf('className="mobility-control-row"')
      < mobilityAtlas.indexOf('className="mobility-timeline-slot"'),
  );
  assert.match(mobilityStory, /mobility-dynamics\.json/);
  assert.match(mobilityStory, /mobility-weekly\.bin/);
  assert.match(mobilityStory, /rootMargin: "1200px 0px"/);
  assert.match(mobilityStory, /Mobility at week t is compared with incidence at week t \+ lag/);
  assert.match(mobilityStory, /does not estimate a causal effect/);
  assert.match(styles, /\.mobility-timeline \{/);
  assert.match(baseMobilitySectionTitleRule, /max-width: 18ch/);
  assert.match(baseMobilityFigureTitleRule, /max-width: 18ch/);
  assert.doesNotMatch(baseMobilitySectionTitleRule, /white-space: nowrap/);
  assert.doesNotMatch(baseMobilityFigureTitleRule, /white-space: nowrap/);
  assert.match(
    wideMobilityCss,
    /\.mobility-section-heading \.section-heading-copy h2,\s*\.mobility-figure-heading-plain h3\s*\{[^}]*max-width: none;[^}]*white-space: nowrap;/,
  );
  assert.match(
    wideMobilityCss,
    /\.mobility-figure-heading-plain > div \{[^}]*width: 100%;[^}]*max-width: none;/,
  );
  assert.match(
    wideMobilityCss,
    /\.mobility-figure-heading-plain h3 \{[^}]*font-size: clamp\(2\.2rem, 4\.4vw, 4\.1rem\);/,
  );
  assert.match(styles, /\.mobility-control-desk \{[\s\S]*?position: sticky;/);
  assert.match(styles, /\.mobility-timeline-slot \{/);
  assert.match(styles, /\.mobility-county-map-canvas/);
  assert.match(styles, /\.mobility-lag-canvas/);
  assert.match(mobilityBuild, /county_in_weekly/);
  assert.match(mobilityBuild, /pulseBaseline/);
  assert.match(mobilityBuild, /KANGWEEKLYFLOW01/);
  assert.equal(mobility.meta.coverageStart, "2019-01-07");
  assert.equal(mobility.meta.coverageEnd, "2022-01-02");
  assert.equal(mobility.meta.sourceFileCount, 156);
  assert.equal(mobility.meta.metric, "visitor_flows");
  assert.equal(mobility.meta.rowCount, 92_042_033);
  assert.equal(mobility.meta.validRowCount, 91_607_589);
  assert.equal(mobility.meta.totalObserved, 21_337_980_141);
  assert.equal(mobility.meta.countyCount, 3_142);
  assert.equal(mobility.meta.stateCount, 51);
  assert.equal(mobility.statePairs.length, 1_275);
  assert.equal(mobility.counties.length, 3_142);
  assert.equal(mobility.quality.malformedRows, 0);
  assert.equal(mobility.quality.negativeValueRows, 0);
  assert.equal(mobility.quality.duplicatePairsWithinSourceFile, 0);
  assert.equal(mobility.quality.dateRangeConflicts, 0);
  assert.equal(mobility.quality.sourceWeekGaps, 0);
  assert.equal(mobility.quality.duplicatePairsWithinOrigin, 0);
  assert.equal(mobility.quality.originBlockReentries, 0);
  assert.equal(mobility.quality.countyLabelConflicts, 0);

  assert.equal(mobilityDynamics.version, 1);
  assert.equal(mobilityDynamics.coverageStart, "2019-01-07");
  assert.equal(mobilityDynamics.coverageEnd, "2022-01-02");
  assert.equal(mobilityDynamics.weekCount, 156);
  assert.equal(mobilityDynamics.countyCount, 3_142);
  assert.equal(mobilityDynamics.fieldCount, 2);
  assert.equal(mobilityDynamics.pulse.length, 156);
  assert.equal(mobilityDynamics.geometryBuildId, countyMetadata.buildId);
  assert.equal(mobilityWeekly.byteLength, mobilityDynamics.binaryBytes);
  assert.equal(mobilityWeekly.byteLength, 16 + (156 * 3_142 * 2 * 4));
  assert.equal(
    mobilityWeekly.subarray(0, mobilityDynamics.binaryHeaderBytes).toString("hex"),
    mobilityDynamics.buildId,
  );
  assert.equal(mobilityDynamics.pulse[0].weekStart, "2019-01-07");
  assert.equal(mobilityDynamics.pulse.at(-1).weekEnd, "2022-01-02");
  mobilityDynamics.pulse.forEach((row, index) => {
    assert.equal(row.seasonalWeek, (index % 52) + 1);
    assert.equal(row.withinCountyObserved + row.crossCountyObserved, row.totalObserved);
    assert.equal(
      row.intrastateCrossCountyObserved + row.interstateObserved,
      row.crossCountyObserved,
    );
    if (index < 52) {
      assert.equal(row.totalIndex, 100);
      assert.equal(row.withinCountyIndex, 100);
      assert.equal(row.crossCountyIndex, 100);
    }
    if (index > 0) {
      assert.equal(
        Date.parse(row.weekStart) - Date.parse(mobilityDynamics.pulse[index - 1].weekStart),
        7 * 86_400_000,
      );
    }
  });

  let inboundArchiveTotal = 0;
  let outboundArchiveTotal = 0;
  const flowValue = (week, county, field) => mobilityWeekly.readUInt32LE(
    mobilityDynamics.binaryHeaderBytes
      + (((week * mobilityDynamics.countyCount + county) * mobilityDynamics.fieldCount + field) * 4),
  );
  for (let week = 0; week < mobilityDynamics.weekCount; week += 1) {
    let inboundWeek = 0;
    let outboundWeek = 0;
    for (let county = 0; county < mobilityDynamics.countyCount; county += 1) {
      inboundWeek += flowValue(week, county, 0);
      outboundWeek += flowValue(week, county, 1);
    }
    assert.equal(inboundWeek, outboundWeek);
    assert.equal(inboundWeek, mobilityDynamics.pulse[week].crossCountyObserved);
    inboundArchiveTotal += inboundWeek;
    outboundArchiveTotal += outboundWeek;
  }
  const expectedCrossCounty = mobility.meta.intrastateCrossCountyObserved + mobility.meta.interstateObserved;
  assert.equal(inboundArchiveTotal, expectedCrossCounty);
  assert.equal(outboundArchiveTotal, expectedCrossCounty);
  assert.deepEqual(
    new Set(mobility.counties.map((county) => county.fips)),
    new Set(countyMetadata.geometry.counties.map((county) => county.fips)),
  );

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await access(new URL("../public/favicon.png", import.meta.url));
  await access(new URL("../analysis/kang_mobility_data_quality.ipynb", import.meta.url));
  await access(new URL("../analysis/prepare_kang_mobility_all.R", import.meta.url));
  await access(new URL("../analysis/prepare_county_incidence.mjs", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
});
