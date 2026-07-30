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

test("server-renders the finished point-process lab shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>COVID Point Process Lab<\/title>/i);
  assert.match(html, /Learn counting processes, intensity estimation, Poisson models/i);
  assert.match(html, /\/og-v2\.png/);
  assert.match(html, /Loading 63,000\+ grouped daily reports/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Starter Project/i);
});

test("ships the archive, statistical engine, and bespoke lab preview assets", async () => {
  const [national, states, socialCard, packageJson, page, layout, statistics] = await Promise.all([
    readFile(new URL("../public/data/us.csv", import.meta.url), "utf8"),
    readFile(new URL("../public/data/us-states.csv", import.meta.url), "utf8"),
    readFile(new URL("../public/og-v2.png", import.meta.url)),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/pointProcess.ts", import.meta.url), "utf8"),
  ]);

  assert.match(national, /^date,geoid,cases,cases_avg,cases_avg_per_100k/);
  assert.match(states, /^date,geoid,state,cases,cases_avg,cases_avg_per_100k/);
  assert.ok(national.split("\n").length >= 1_158);
  assert.ok(states.split("\n").length >= 61_942);
  assert.equal(socialCard.readUInt32BE(16), 1734);
  assert.equal(socialCard.readUInt32BE(20), 907);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(page, /<CovidAtlas \/>/);
  assert.match(layout, /generateMetadata/);
  assert.match(statistics, /export function poissonLogLikelihood/);
  assert.match(statistics, /export function simulatePoissonPaths/);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await access(new URL("../public/favicon-v2.png", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
});
