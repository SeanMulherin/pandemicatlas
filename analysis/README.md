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
