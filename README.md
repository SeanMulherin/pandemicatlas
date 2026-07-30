# COVID Point Process Lab

An interactive statistical workbench for learning point-process concepts with
The New York Times U.S. COVID-19 archive. The lab connects daily grouped reports
to counting processes, intensity estimation, Poisson likelihoods, residual
diagnostics, and reproducible simulation.

## Develop

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

## Validate

```bash
npm test
```

The site includes local snapshots of the Times's national and state daily-report
CSV files under `public/data` so the lab does not depend on a live third-party
request. The interface explicitly distinguishes grouped reporting counts from
exact event times and exposes its handling of negative reporting corrections.

Source dataset: https://github.com/nytimes/covid-19-data
