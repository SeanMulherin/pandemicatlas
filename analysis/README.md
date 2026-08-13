# Kang mobility build

`prepare_kang_mobility_all.R` regenerates `public/data/mobility.json` from all
156 county-level weeks in the official Kang/GeoDS weekly-flow repository. The
published ranges run from January 7, 2019 through January 2, 2022.

The script clones the source as a compressed bare Git repository and streams
each CSV from the Git object database. It does not expand or retain the roughly
11 GB of raw CSV files.

Requirements: R, Git, and the R packages `data.table` and `jsonlite`.

```sh
Rscript analysis/prepare_kang_mobility_all.R
```

Set `KANG_CACHE_DIR` to choose a persistent cache location, or use
`--repo=/path/to/COVID19USFlows-WeeklyFlows.git` to reuse an existing bare
clone. `--output=` and `--labels=` override the generated JSON path and the
existing atlas JSON used for county display names.

The atlas intentionally reports `visitor_flows`, the detected SafeGraph sample,
rather than `pop_flows`, the population-inferred estimate. The build replaces
the NYT case archive's combined New York City and Alaska labels with Kang's
official county GEOIDs. Records involving jurisdictions outside the atlas's
50-state-plus-D.C. geography are counted in the quality report and excluded
from the displayed totals.

## County incidence build

`prepare_county_incidence.mjs` creates the animated county choropleth from The
New York Times's four yearly county rolling-average files and the preprojected
`counties-albers-10m.json` boundary file from `us-atlas`.

```sh
node analysis/prepare_county_incidence.mjs \
  --counties-dir=/path/to/nyt/rolling-averages \
  --topology=/path/to/counties-albers-10m.json \
  --output-dir=public/data
```

The build emits:

- `county-incidence-map.json`: compact county paths, labels, scale metadata,
  reporting-area notes, source links, and QA totals.
- `county-incidence.bin`: a date-major `Uint8` matrix for cases, cases per
  100,000, deaths, and deaths per 100,000. Each field uses `log1p` encoding on a
  fixed archive-wide domain capped at its 99.5th percentile; `255` is reserved
  for dates before a county begins reporting. A short build-identity header
  prevents a stale binary from being paired with a different map index.

The client decodes those values into approximate display values and paints the
3,142 county geometries on Canvas. Using one fixed color scale prevents the map
from changing meaning as the shared date animation advances. New York City and
two Alaska combined reporting areas are explicitly mapped to their component
county geometries and identified as combined areas in the detail panel.
Strict build checks reject missing source columns, incomplete yearly date
ranges, duplicate county-date rows, unmapped counties, and gaps after a county
has begun reporting.

Source data: https://github.com/nytimes/covid-19-data/tree/master/rolling-averages

Boundary data: https://github.com/topojson/us-atlas
