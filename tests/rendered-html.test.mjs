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

function countyCenterFromPath(path, state) {
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
    const points = [];
    for (let index = 0; index + 1 < coordinates.length; index += 2) {
      const x = coordinates[index];
      const y = coordinates[index + 1];
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

  const region = state === "Alaska" ? "alaska" : state === "Hawaii" ? "hawaii" : "contiguous";
  if (Math.abs(totalArea) > Number.EPSILON) {
    return { x: weightedX / totalArea, y: weightedY / totalArea, region };
  }
  return { x: (minimumX + maximumX) / 2, y: (minimumY + maximumY) / 2, region };
}

function directionalCountyIndex(centers, currentIndex, key) {
  const origin = centers[currentIndex];
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
    const score = Math.hypot(deltaX, deltaY) + 2 * perpendicular;
    if (score >= bestScore) return;
    bestScore = score;
    bestIndex = index;
  });
  return bestIndex;
}

test("server-renders the finished Pandemic Atlas shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>The Pandemic Atlas<\/title>/i);
  assert.match(html, /Trace U\.S\. COVID-19 cases and deaths/i);
  assert.match(html, /\/og\.png/);
  assert.match(html, />SM<\/a>/);
  assert.match(html, />Apps<\/a>/);
  assert.match(html, />Scholarship<\/a>/);
  assert.match(html, />Teachings<\/a>/);
  assert.match(html, />CV<\/a>/);
  assert.match(html, /A visual record of COVID-19 in the United States/);
  assert.match(html, /1,158 days/);
  assert.match(html, /103\.9M/);
  assert.match(html, /1\.1M/);
  assert.match(html, /I developed this historical atlas, recently enhanced with ChatGPT/);
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
    stateMap,
    styles,
    countyMap,
    countyNavigation,
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
    readFile(new URL("../app/StateIncidenceMap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/CountyIncidenceMap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/countySpatialNavigation.ts", import.meta.url), "utf8"),
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
  const mobilityLedgerRule = firstCssRule(".mobility-ledger");
  const heroLedgerRule = firstCssRule(".hero-ledger");
  const heroArchiveSpanRule = firstCssRule(".hero-ledger > div:first-child strong");
  const heroIntroRule = firstCssRule(".hero-intro");
  const stateMapSvgRule = firstCssRule(".state-map-svg");
  const htmlRule = firstCssRule("html");
  const baseMobilitySectionTitleRule = firstCssRule(
    ".mobility-section-heading .section-heading-copy h2",
  );
  const baseMobilityFigureTitleRule = firstCssRule(".mobility-figure-heading h3");
  const mobilityTimelineReadoutRule = firstCssRule(".mobility-timeline-readout");
  const mobilityTimelineValueRule = firstCssRule(".mobility-timeline-readout strong");
  const wideMobilityCss = cssBlockAfter(styles, "@media (min-width: 50.01rem)");
  const narrowMobilityCss = cssBlockAfter(styles, "@media (max-width: 50rem)");
  const phoneCss = cssBlockAfter(styles, "@media (max-width: 34rem)");

  assert.match(national, /^date,geoid,cases,cases_avg,cases_avg_per_100k/);
  assert.match(states, /^date,geoid,state,cases,cases_avg,cases_avg_per_100k/);
  assert.ok(national.split("\n").length >= 1_158);
  assert.ok(states.split("\n").length >= 61_942);
  assert.equal(socialCard.readUInt32BE(16), 1731);
  assert.equal(socialCard.readUInt32BE(20), 909);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(headerRule, /position:\s*fixed/);
  assert.match(headerRule, /top:\s*0/);
  assert.match(headerRule, /height:\s*60px/);
  assert.match(headerRule, /background-color:\s*#fff/);
  assert.match(styles, /body\s*\{[^}]*padding-top:\s*60px/);
  assert.match(styles, /@media \(max-width:\s*900px\)[\s\S]*?body\s*\{[^}]*padding-top:\s*104px/);
  assert.match(explorerControlsRule, /position:\s*sticky/);
  assert.match(explorerControlsRule, /top:\s*0/);
  assert.match(
    explorerControlsRule,
    /transform:\s*translateY\(var\(--explorer-handoff-offset\)\)/,
  );
  assert.match(explorerControlsRule, /will-change:\s*transform/);
  assert.match(
    styles,
    /\.explorer-controls\.is-displaced\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/,
  );
  assert.match(mobilityControlsRule, /position:\s*sticky/);
  assert.match(mobilityControlsRule, /top:\s*0/);
  assert.match(mobilityControlsRule, /margin-top:\s*clamp\(5rem,\s*10vw,\s*9rem\)/);
  assert.match(htmlRule, /scroll-padding-top:\s*10rem/);
  assert.match(page, /<CovidAtlas \/>/);
  assert.match(layout, /generateMetadata/);
  assert.match(atlas, /className="site-logo"/);
  assert.match(atlas, />Scholarship<\/a>/);
  assert.match(atlas, /className="hero-intro"/);
  assert.match(atlas, /I developed this historical atlas, recently enhanced with ChatGPT/);
  assert.match(atlas, /The New York Times national, state,\s*and county/);
  assert.match(atlas, /mobility data described by\s*Kang et al\. \(2020\)/);
  assert.doesNotMatch(atlas, /coordinated interactives|easier to investigate/);
  assert.match(atlas, /comparisons easier to explore/);
  assert.match(
    atlas,
    /nationwide incidence through statewide dynamics\s*and rankings to countywide patterns/,
  );
  assert.match(heroLedgerRule, /grid-template-columns:\s*minmax\(16rem,\s*1\.2fr\)/);
  assert.match(heroArchiveSpanRule, /white-space:\s*nowrap/);
  assert.match(heroIntroRule, /border-left:\s*3px solid var\(--cases\)/);
  assert.match(
    firstCssRule(".hero-ledger", narrowMobilityCss),
    /grid-template-columns:\s*minmax\(11\.5rem,\s*1\.25fr\)/,
  );
  assert.match(
    firstCssRule(".hero-ledger > div:first-child strong", narrowMobilityCss),
    /font-size:\s*clamp\(1\.25rem,\s*4vw,\s*1\.75rem\)/,
  );
  assert.match(firstCssRule(".hero-ledger", phoneCss), /grid-template-columns:\s*1fr/);
  assert.match(atlas, /href="https:\/\/seanmulherin\.github\.io\/">SM<\/a>/);
  assert.match(atlas, /Nationwide Incidence/);
  assert.match(atlas, /Statewide Incidence/);
  assert.match(atlas, /<h2 className="states-title">Statewide Incidence<\/h2>/);
  assert.match(atlas, /<h2 className="analysis-title">Statewide Waves<\/h2>/);
  assert.match(atlas, /\(Un\)select the states you wish to highlight for evaluation/);
  assert.match(atlas, /Choose up to ten states on the map/);
  assert.match(atlas, /MAX_SELECTED_STATES = 10/);
  assert.match(atlas, /<StateIncidenceMap/);
  assert.doesNotMatch(atlas, /State tile map|className="tile-map"|className=\{`state-tile/);
  assert.match(stateMap, /atlasAssetUrl\("data\/county-incidence-map\.json"\)/);
  assert.match(stateMap, /<svg/);
  assert.match(stateMap, /stateBordersPath/);
  assert.match(stateMap, /nationPath/);
  assert.match(stateMap, /role="button"/);
  assert.match(stateMap, /tabIndex=\{0\}/);
  assert.match(stateMap, /aria-pressed=\{isSelected\}/);
  assert.match(stateMap, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(stateMap, /onClick=\{\(\) => onToggleState\(state\.name\)\}/);
  assert.match(stateMap, /onFocus=\{\(\) => setFocusedState\(state\.name\)\}/);
  assert.match(stateMap, /className="state-map-focus-outline"/);
  assert.doesNotMatch(stateMap, /detailSelected|Remove from comparison|Add to comparison/);
  assert.doesNotMatch(styles, /\.state-map-detail\s*>\s*button\s*\{/);
  assert.match(
    styles,
    /\.state-map-shape:hover,\s*\.state-map-shape:focus,\s*\.state-map-shape:focus-visible\s*\{[^}]*outline:\s*none;/,
  );
  assert.match(
    styles,
    /\.state-map-focus-outline path\s*\{[^}]*stroke:\s*var\(--ink\);[^}]*stroke-width:\s*2;/,
  );
  assert.match(stateMapSvgRule, /width:\s*100%/);
  assert.doesNotMatch(styles, /\.tile-map\s*\{|\.state-tile(?:\s|:|\.)/);
  assert.match(atlas, /Statewide Rankings/);
  assert.match(atlas, /<CountyIncidenceMap/);
  assert.match(atlas, /const explorerControlsRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(atlas, /const updateExplorerControlHandoff = useCallback/);
  assert.match(atlas, /Math\.max\(0, controlsHeight - mobilitySectionTop\)/);
  assert.match(
    atlas,
    /window\.getComputedStyle\(controls\)\.position !== "sticky"/,
  );
  assert.match(atlas, /style\.setProperty\("--explorer-handoff-offset"/);
  assert.match(atlas, /classList\.toggle\("is-displaced"/);
  assert.match(atlas, /ref=\{explorerControlsRef\} className="explorer-controls"/);
  assert.match(atlas, /onSectionPositionChange=\{updateExplorerControlHandoff\}/);
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
  assert.ok(atlas.indexOf("<CountyIncidenceMap") < atlas.indexOf("<MobilityAtlas"));
  assert.match(countyMap, /Countywide Incidence/);
  assert.match(countyMap, /Darker blue indicates higher incidence/);
  assert.match(countyMap, /county-incidence-map\.json/);
  assert.match(countyMap, /county-incidence\.bin/);
  assert.match(countyMap, /selectedDate/);
  assert.match(countyMap, /maximumEncodedValue/);
  assert.match(countyMap, /No report/);
  assert.match(countyMap, /highestValue > 0 \? highestIndex : null/);
  assert.match(countyMap, /!isPlaying && selectedCounty !== null/);
  assert.match(countyMap, /from "\.\/countySpatialNavigation"/);
  assert.match(countyMap, /const countyCenters = useMemo/);
  assert.match(countyMap, /isCountyArrowKey\(event\.key\)/);
  assert.match(countyMap, /context\.isPointInPath\(paths\.counties\[candidateIndex\], mapX, mapY\)/);
  assert.match(countyMap, /event\.pointerType !== "mouse" && county !== null/);
  assert.match(countyMap, /pointerInsideMap\s*\? hoveredCounty/);
  assert.match(countyMap, /Hover or tap to inspect/);
  assert.doesNotMatch(countyMap, /if \(county !== null\) setSelectedCounty\(county\)/);
  assert.doesNotMatch(
    countyMap,
    /next = \(current \+ 1\) % assets\.metadata\.countyCount|next = \(current - 1 \+ assets\.metadata\.countyCount\)/,
  );
  assert.match(countyMap, /nearest county in that direction/);
  assert.match(countyNavigation, /export function countyCenter/);
  assert.match(countyNavigation, /export function spatialCountyIndex/);
  assert.match(countyNavigation, /candidate\.region !== origin\.region/);
  assert.match(countyNavigation, /perpendicular > forward/);
  assert.match(countyBuild, /CAP_QUANTILE = 0\.995/);
  assert.match(countyBuild, /SPECIAL_REPORTING_AREAS/);
  assert.match(countyBuild, /Internal reporting gap/);
  assert.equal(countyMetadata.coverageStart, "2020-01-21");
  assert.equal(countyMetadata.coverageEnd, "2023-03-23");
  assert.equal(countyMetadata.dayCount, 1_158);
  assert.equal(countyMetadata.countyCount, 3_142);
  assert.equal(countyMetadata.geometry.counties.length, 3_142);
  assert.equal(new Set(countyMetadata.geometry.counties.map(({ state }) => state)).size, 51);
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
  const countyCenters = countyMetadata.geometry.counties.map((county) => (
    countyCenterFromPath(county.path, county.state)
  ));
  const expectedLosAngelesMoves = {
    ArrowRight: "06071",
    ArrowLeft: "06111",
    ArrowUp: "06029",
    ArrowDown: "06059",
  };
  Object.entries(expectedLosAngelesMoves).forEach(([key, fips]) => {
    const destination = directionalCountyIndex(countyCenters, losAngelesIndex, key);
    assert.equal(countyMetadata.geometry.counties[destination].fips, fips);
  });
  ["51610", "51678", "51685"].forEach((fips) => {
    const index = countyMetadata.geometry.counties.findIndex((county) => county.fips === fips);
    assert.ok(Number.isFinite(countyCenters[index].x) && Number.isFinite(countyCenters[index].y));
  });
  assert.match(mobilityAtlas, /Human Mobility Patterns/);
  assert.match(mobilityAtlas, /Human mobility is defined here as the origin-to-destination/);
  assert.doesNotMatch(mobilityAtlas, /We define human mobility/);
  assert.match(mobilityAtlas, /all modes of/);
  assert.match(mobilityAtlas, /Data represent ~10%/);
  assert.match(mobilityAtlas, /daily county release ends Apr\. 15, 2021/);
  assert.match(mobilityAtlas, /weekly county release continues/);
  assert.match(mobilityAtlas, /Where state borders were most porous/);
  assert.match(
    mobilityAtlas,
    /The 75 largest two-way interstate ties are shown\. Select a state to reveal its/,
  );
  assert.doesNotMatch(mobilityAtlas, /Focus a state to reveal|Focused state/);
  assert.match(mobilityAtlas, /<span><i className="is-red" \/>Selected state<\/span>/);
  assert.match(mobilityAtlas, /Which counties pulled travel in—or pushed it out/);
  assert.match(mobilityAtlas, /const \[lastSelectedState, setLastSelectedState\]/);
  assert.match(mobilityAtlas, /if \(state !== ALL_STATES\) setLastSelectedState\(state\)/);
  assert.match(mobilityAtlas, /role="group"\s+aria-labelledby="county-scope-label"/);
  assert.match(mobilityAtlas, /aria-pressed=\{focusState === ALL_STATES\}/);
  assert.match(mobilityAtlas, /aria-pressed=\{focusState !== ALL_STATES\}/);
  assert.match(mobilityAtlas, /onClick=\{\(\) => handleFocusState\(ALL_STATES\)\}/);
  assert.match(mobilityAtlas, /onClick=\{\(\) => handleFocusState\(lastSelectedState\)\}/);
  assert.match(mobilityAtlas, /disabled=\{!lastSelectedState\}/);
  assert.ok(
    mobilityAtlas.indexOf('id="county-scope-label"')
      < mobilityAtlas.indexOf("<CountyBalance"),
  );
  assert.match(
    styles,
    /\.county-scope-toggle button\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--ink\);/,
  );
  assert.match(
    styles,
    /\.county-scope-toggle button:disabled\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*0\.42;/,
  );
  assert.match(
    narrowMobilityCss,
    /\.county-scope-control\s*\{[^}]*flex-direction:\s*column;/,
  );
  assert.match(mobilityAtlas, /<MobilityStory/);
  assert.match(
    mobilityAtlas,
    /const mobilitySectionRef = useRef<HTMLElement>\(null\)/,
  );
  assert.match(mobilityAtlas, /section\.getBoundingClientRect\(\)\.top/);
  assert.doesNotMatch(mobilityAtlas, /desk\.getBoundingClientRect\(\)\.top/);
  assert.match(mobilityAtlas, /window\.requestAnimationFrame\(updatePosition\)/);
  assert.match(
    mobilityAtlas,
    /window\.addEventListener\("scroll", scheduleUpdate, \{ passive: true \}\)/,
  );
  assert.match(mobilityAtlas, /new ResizeObserver\(scheduleUpdate\)/);
  assert.match(
    mobilityAtlas,
    /layoutObserver\?\.observe\(mobilitySectionRef\.current\)/,
  );
  assert.match(
    mobilityAtlas,
    /className="atlas-section mobility-section" id="mobility" ref=\{mobilitySectionRef\}/,
  );
  assert.equal(
    mobilityAtlas.match(/className="atlas-section mobility-section" id="mobility" ref=\{mobilitySectionRef\}/g)?.length,
    2,
  );
  assert.match(mobilityAtlas, /className="mobility-control-desk"/);
  assert.doesNotMatch(mobilityAtlas, /mobility-sticky-sentinel/);
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
    "Mobility Flow Map",
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
  assert.doesNotMatch(mobilityAtlas, /mobility-control-row|mobility-state-focus|Reset focus/);
  assert.match(mobilityStory, /className="mobility-spotlight-controls"/);
  assert.match(mobilityStory, /const startDate = pulse\[0\]\?\.weekStart/);
  assert.match(mobilityStory, /const endDate = pulse\.at\(-1\)\?\.weekEnd/);
  assert.match(mobilityStory, /className="mobility-timeline-range"/);
  assert.match(mobilityStory, /aria-label="Mobility week"/);
  assert.match(mobilityStory, /const MOBILITY_PLAYBACK_INTERVAL_MS = 350/);
  assert.match(mobilityStory, /\}, MOBILITY_PLAYBACK_INTERVAL_MS\);/);
  assert.doesNotMatch(mobilityStory, /\}, 650\);/);
  assert.equal(mobilityDynamics.weekCount * 350, 54_600);
  assert.match(
    mobilityStory,
    /startDate \? weekFormatter\.format\(new Date\(`\$\{startDate\}T00:00:00Z`\)\) : ""/,
  );
  assert.match(
    mobilityStory,
    /endDate \? weekFormatter\.format\(new Date\(`\$\{endDate\}T00:00:00Z`\)\) : ""/,
  );
  assert.match(mobilityStory, /mobility-dynamics\.json/);
  assert.match(mobilityStory, /mobility-weekly\.bin/);
  assert.match(mobilityStory, /rootMargin: "1200px 0px"/);
  assert.match(mobilityStory, /Mobility at week t is compared with national incidence at week t \+ lag/);
  assert.match(mobilityStory, /does not estimate a causal effect/);
  assert.match(atlas, /onCovidMetricChange=\{setMetric\}/);
  assert.match(mobilityAtlas, /onCovidMetricChange=\{onCovidMetricChange\}/);
  assert.match(mobilityStory, /<legend>Outcome<\/legend>/);
  assert.match(mobilityStory, /\(\["cases", "deaths"\] as const\)\.map/);
  assert.match(mobilityStory, /aria-pressed=\{covidMetric === option\}/);
  assert.match(mobilityStory, /onClick=\{\(\) => onCovidMetricChange\(option\)\}/);
  assert.match(mobilityStory, /reported cases or deaths per 100,000 residents 0–8 weeks later/);
  assert.match(mobilityStory, /100 equals that baseline/);
  assert.match(mobilityStory, /all seven lagged COVID-19 dates are retained/);
  assert.match(mobilityStory, /unadjusted\s*Pearson correlation/);
  assert.match(mobilityStory, /not causal estimates/);
  assert.match(mobilityStory, /niceAxisTicks\(xMinimum, xMaximum, 8\)/);
  assert.match(mobilityStory, /corresponding 2019 week as a baseline of 100/);
  assert.match(mobilityStory, /context\.lineTo\(x, margin\.top \+ height \+ 5\)/);
  assert.match(mobilityStory, /context\.fillText\(String\(tickValue\), x, margin\.top \+ height \+ 8\)/);
  assert.match(styles, /\.mobility-lag-metric \{/);
  assert.match(styles, /\.mobility-lag-metric button\.is-cases\[aria-pressed="true"\]/);
  assert.match(styles, /\.mobility-lag-metric button\.is-deaths\[aria-pressed="true"\]/);
  assert.match(mobilityStory, /from "\.\/countySpatialNavigation"/);
  assert.match(mobilityStory, /const countyCenters = useMemo/);
  assert.match(mobilityStory, /isCountyArrowKey\(event\.key\)/);
  assert.match(
    mobilityStory,
    /spatialCountyIndex\(countyCenters, selectedIndex, event\.key\)/,
  );
  assert.match(mobilityStory, /navigate spatially between counties/);
  assert.match(mobilityStory, /nearest county in that direction/);
  assert.doesNotMatch(
    mobilityStory,
    /selectedIndex \+ 1|selectedIndex - 1 \+ assets\.metadata\.countyCount/,
  );
  assert.match(
    mobilityStory,
    /context\.isPointInPath\(paths\.counties\[candidateIndex\], mapX, mapY\)/,
  );
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
  assert.match(
    mobilityLedgerRule,
    /grid-template-columns:\s*minmax\(18rem, 1\.25fr\) repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    wideMobilityCss,
    /\.mobility-ledger > div:first-child strong\s*\{[^}]*white-space:\s*nowrap;/,
  );
  assert.match(
    narrowMobilityCss,
    /\.mobility-ledger\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(styles, /\.mobility-control-desk \{[\s\S]*?position: sticky;/);
  assert.doesNotMatch(styles, /\.mobility-sticky-sentinel/);
  assert.match(
    narrowMobilityCss,
    /\.explorer-controls\s*\{[^}]*position:\s*relative;[^}]*top:\s*auto;/,
  );
  assert.match(
    narrowMobilityCss,
    /\.mobility-control-desk\s*\{[^}]*position:\s*relative;[^}]*top:\s*auto;/,
  );
  assert.match(styles, /\.mobility-timeline-slot \{/);
  assert.match(mobilityTimelineReadoutRule, /min-width:\s*0/);
  assert.match(mobilityTimelineValueRule, /min-block-size:\s*2\.2em/);
  assert.match(mobilityTimelineValueRule, /color:\s*#000/);
  assert.match(
    styles,
    /(?:^|\n)\.mobility-timeline\s*\{[^}]*grid-template-columns:\s*auto minmax\(10rem, 0\.38fr\) minmax\(0, 1\.62fr\)/,
  );
  assert.match(
    firstCssRule(".mobility-timeline-range"),
    /grid-template-columns:\s*max-content minmax\(8rem, 1fr\) max-content/,
  );
  assert.match(
    narrowMobilityCss,
    /\.mobility-timeline-range\s*\{[^}]*grid-row:\s*2;[^}]*grid-column:\s*1 \/ -1;/,
  );
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
  assert.deepEqual(
    mobility.statePairs,
    mobility.statePairs.slice().sort((a, b) => b.value - a.value),
  );
  const interstateTotal = mobility.statePairs.reduce((sum, pair) => sum + pair.value, 0);
  const leadingInterstateTotal = mobility.statePairs
    .slice(0, 75)
    .reduce((sum, pair) => sum + pair.value, 0);
  assert.equal(interstateTotal, mobility.meta.interstateObserved);
  assert.equal(leadingInterstateTotal, 1_048_274_559);
  assert.ok(Math.abs((leadingInterstateTotal / interstateTotal) - 0.5748) < 0.0001);
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
