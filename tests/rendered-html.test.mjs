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
  assert.match(atlas, /<h2 className="states-title">Statewide<\/h2>/);
  assert.match(atlas, /Select the states you wish to highlight for evaluation/);
  assert.match(atlas, /Statewide Burden/);
  assert.match(atlas, /<MobilityAtlas \/>/);
  assert.match(atlas, /Burden is each state’s seven-day average/);
  assert.ok(
    atlas.indexOf('<h2 className="states-title">Statewide</h2>')
      < atlas.indexOf('<h2 className="analysis-title">Statewide Incidence</h2>'),
  );
  assert.match(atlas, /Kang county traveler totals/);
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
  assert.match(mobilityAtlas, /How America moved\./);
  assert.match(mobilityAtlas, /Where state borders were most porous/);
  assert.match(mobilityAtlas, /Which counties pulled travel in—or pushed it out/);
  assert.match(mobilityAtlas, /not unique individuals/);
  assert.equal(mobility.meta.coverageStart, "2020-03-12");
  assert.equal(mobility.meta.coverageEnd, "2020-07-19");
  assert.equal(mobility.meta.validRowCount, 4_051_110);
  assert.equal(mobility.meta.countyCount, 3_135);
  assert.equal(mobility.meta.stateCount, 51);
  assert.equal(mobility.statePairs.length, 1_275);
  assert.equal(mobility.counties.length, 3_135);
  assert.equal(mobility.quality.malformedRows, 0);
  assert.equal(mobility.quality.negativeValueRows, 0);
  assert.equal(mobility.quality.duplicatePairsWithinOrigin, 0);
  assert.equal(mobility.quality.originBlockReentries, 0);
  assert.equal(mobility.quality.countyLabelConflicts, 0);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await access(new URL("../public/favicon.png", import.meta.url));
  await access(new URL("../analysis/kang_mobility_data_quality.ipynb", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
});
