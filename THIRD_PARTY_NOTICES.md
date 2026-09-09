# Third-party data notices

The Pandemic Atlas redistributes compact local derivatives of two public GitHub datasets. The transformations are documented here so that the data sources, field meanings, and reuse conditions travel with the code.

## The New York Times COVID-19 data

**Source:** [nytimes/covid-19-data](https://github.com/nytimes/covid-19-data)  
**Upstream license:** [The New York Times COVID-19 data license](https://github.com/nytimes/covid-19-data/blob/master/LICENSE), which the repository describes as co-extensive with [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)  
**Required attribution:** Data from The New York Times, based on reports from state and local health agencies.

The upstream license permits copying, display, and derivative works for noncommercial purposes with attribution to The New York Times. Commercial use requires permission from `covid-data@nytimes.com`.

The local files are historical snapshots ending March 23, 2023. The atlas reformats national and state rolling-average records, creates a compact county matrix, maps the Times's combined or nonstandard reporting geographies onto display geometry, and clips negative county correction averages to zero for the county color scale. The original reporting caveats remain applicable. See `analysis/prepare_county_incidence.mjs` and the metadata in `public/data/county-incidence-map.json`.

## Kang et al. weekly U.S. mobility flows

**Source:** [GeoDS/COVID19USFlows-WeeklyFlows](https://github.com/GeoDS/COVID19USFlows-WeeklyFlows)  
**Upstream license:** [MIT License](https://github.com/GeoDS/COVID19USFlows-WeeklyFlows/blob/master/LICENSE.txt)  
**Requested citation:** Kang, Y., Gao, S., Liang, Y., Li, M., Rao, J., and Kruse, J. (2020). “Multiscale dynamic human mobility flow dataset in the U.S. during the COVID-19 epidemic.” *Scientific Data*, 7, 390. [https://doi.org/10.1038/s41597-020-00734-5](https://doi.org/10.1038/s41597-020-00734-5)

The atlas aggregates all 156 county-level weekly files from January 7, 2019 through January 2, 2022. It uses `visitor_flows`, which the upstream repository defines as the estimated number of visitors detected by SafeGraph between origin and destination geographies. It does not use `pop_flows`, the inferred population-flow field. Cross-county inbound and outbound totals exclude within-county pairs. These are detected visitor-flow estimates, not unique people, trips, or a population census. See `analysis/prepare_kang_mobility_all.R` and the metadata in `public/data/mobility.json` and `public/data/mobility-dynamics.json`.

The upstream repository's license file is reproduced below as required for copies or substantial portions distributed under that notice. The upstream file contains the copyright line shown here.

```text
MIT License

Copyright (c) 2018 Othneil Drew

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The repository labels the dataset MIT-licensed, although its license file retains a template author's copyright line rather than naming the dataset authors. That ambiguity belongs to the upstream repository; this project preserves the notice exactly and supplies the authors' requested scholarly citation.
