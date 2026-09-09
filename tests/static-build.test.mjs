import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

test("builds a GitHub Pages app with base-aware assets and the complete archive", async () => {
  const html = await readFile(new URL("../dist-github/index.html", import.meta.url), "utf8");
  const assetUrl = await readFile(new URL("../app/assetUrl.ts", import.meta.url), "utf8");

  assert.match(html, /<title>The Pandemic Atlas<\/title>/);
  assert.match(html, /\/pandemicatlas\/assets\//);
  assert.match(html, /\/pandemicatlas\/favicon\.png/);
  assert.match(html, /rel="preload" href="\/pandemicatlas\/data\/us\.csv" as="fetch"/);
  assert.match(html, /rel="preload" href="\/pandemicatlas\/data\/us-states\.csv" as="fetch"/);
  assert.match(assetUrl, /__ATLAS_BASE_PATH__/);

  for (const path of [
    "us.csv",
    "us-states.csv",
    "county-incidence-map.json",
    "county-incidence.bin",
    "mobility.json",
    "mobility-dynamics.json",
    "mobility-weekly.bin",
  ]) {
    await access(new URL(`../dist-github/data/${path}`, import.meta.url));
  }

  assert.ok((await stat(new URL("../dist-github/data/county-incidence.bin", import.meta.url))).size > 10_000_000);
});
