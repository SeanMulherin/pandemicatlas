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
  assert.match(html, /Preparing 63,000\+ daily records/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Starter Project/i);
});

test("ships the complete local archive and bespoke preview assets", async () => {
  const [national, states, mobilityRaw, socialCard, packageJson, page, layout, atlas, mobilityAtlas] = await Promise.all([
    readFile(new URL("../public/data/us.csv", import.meta.url), "utf8"),
    readFile(new URL("../public/data/us-states.csv", import.meta.url), "utf8"),
    readFile(new URL("../public/data/mobility.json", import.meta.url), "utf8"),
    readFile(new URL("../public/og.png", import.meta.url)),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/CovidAtlas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/MobilityAtlas.tsx", import.meta.url), "utf8"),
  ]);
  const mobility = JSON.parse(mobilityRaw);

  assert.match(national, /^date,geoid,cases,cases_avg,cases_avg_per_100k/);
  assert.match(states, /^date,geoid,state,cases,cases_avg,cases_avg_per_100k/);
  assert.ok(national.split("\n").length >= 1_158);
  assert.ok(states.split("\n").length >= 61_942);
  assert.equal(socialCard.readUInt32BE(16), 1731);
  assert.equal(socialCard.readUInt32BE(20), 909);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
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
  assert.match(atlas, /Statewide Ranks/);
  assert.match(atlas, /<MobilityAtlas \/>/);
  assert.doesNotMatch(atlas, /Burden ranks states by the active metric and view/);
  assert.match(atlas, /className="floating-playback"/);
  assert.match(atlas, /ref=\{timeConsoleRef\}/);
  assert.ok(
    atlas.indexOf('<h2 className="states-title">Statewide Incidence</h2>')
      < atlas.indexOf('<h2 className="analysis-title">Statewide Waves</h2>'),
  );
  assert.match(atlas, /Kang county traveler totals/);
  assert.match(atlas, /01 \/ Sources/);
  assert.match(atlas, /all 156 official weekly county files/);
  assert.match(atlas, /January 7, 2019 through January 2, 2022/);
  assert.match(atlas, /cumulative movements, not unique/);
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
  assert.match(mobilityAtlas, /Human Mobility Patterns/);
  assert.match(mobilityAtlas, /We define human mobility/);
  assert.match(mobilityAtlas, /all modes of/);
  assert.match(mobilityAtlas, /Data represent ~10%/);
  assert.match(mobilityAtlas, /daily county release ends Apr\. 15, 2021/);
  assert.match(mobilityAtlas, /weekly county release continues/);
  assert.match(mobilityAtlas, /Where state borders were most porous/);
  assert.match(mobilityAtlas, /Which counties pulled travel in—or pushed it out/);
  assert.match(mobilityAtlas, /not unique individuals/);
  assert.doesNotMatch(mobilityAtlas, /05<\/span> Human mobility|01 \/ Interstate network|02 \/ County hubs/);
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

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await access(new URL("../public/favicon.png", import.meta.url));
  await access(new URL("../analysis/kang_mobility_data_quality.ipynb", import.meta.url));
  await access(new URL("../analysis/prepare_kang_mobility_all.R", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
});
