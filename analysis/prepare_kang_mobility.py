"""Profile the legacy March-July 2020 Kang traveler extract.

The raw file is streamed so the 247 MB uncompressed CSV never has to be loaded
fully into memory. The live atlas is built from all 156 official weekly files by
``prepare_kang_mobility_all.R``; this module remains for auditing the original
user-supplied extract.
"""

from __future__ import annotations

from collections import defaultdict
import csv
import gzip
import json
from pathlib import Path
from typing import Any


DEFAULT_SOURCE = Path(
    "/Users/seanmulherin/Desktop/Research/Paper 2/data/raw/"
    "kang_2020_county_traveler_totals_2020-03-12_to_2020-07-19.csv.gz"
)


def parse_location(value: str) -> tuple[str, str, str] | None:
    parts = [part.strip() for part in value.split(" | ")]
    if len(parts) < 3 or not parts[0] or not parts[-1]:
        return None
    state = parts[0]
    county = " | ".join(parts[1:-1])
    fips = parts[-1].zfill(5)
    return state, county, fips


def profile_and_aggregate(
    source_path: Path = DEFAULT_SOURCE,
    output_path: Path | None = None,
) -> dict[str, Any]:
    row_count = 0
    valid_row_count = 0
    malformed_rows = 0
    negative_value_rows = 0
    zero_value_rows = 0
    duplicate_pairs_within_origin = 0
    origin_block_reentries = 0
    total_observed = 0
    intracounty_observed = 0
    intrastate_cross_county_observed = 0
    interstate_observed = 0

    county_meta: dict[str, tuple[str, str]] = {}
    county_label_conflicts = 0
    county_inbound: defaultdict[str, int] = defaultdict(int)
    county_outbound: defaultdict[str, int] = defaultdict(int)
    state_intrastate: defaultdict[str, int] = defaultdict(int)
    state_interstate_in: defaultdict[str, int] = defaultdict(int)
    state_interstate_out: defaultdict[str, int] = defaultdict(int)
    directed_state_flows: defaultdict[tuple[str, str], int] = defaultdict(int)
    undirected_state_pairs: defaultdict[tuple[str, str], int] = defaultdict(int)
    states: set[str] = set()
    origin_counties: set[str] = set()
    destination_counties: set[str] = set()
    seen_origin_blocks: set[str] = set()
    current_origin = ""
    destinations_for_origin: set[str] = set()

    with gzip.open(source_path, "rt", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        expected = {"origin_county_id", "destination_county_id", "observed_travelers"}
        if set(reader.fieldnames or []) != expected:
            raise ValueError(f"Unexpected columns: {reader.fieldnames}")

        for row in reader:
            row_count += 1
            origin_label = (row.get("origin_county_id") or "").strip()
            destination_label = (row.get("destination_county_id") or "").strip()
            origin = parse_location(origin_label)
            destination = parse_location(destination_label)
            try:
                observed = int(row.get("observed_travelers") or "")
            except ValueError:
                malformed_rows += 1
                continue
            if origin is None or destination is None:
                malformed_rows += 1
                continue
            if observed < 0:
                negative_value_rows += 1
                continue
            if observed == 0:
                zero_value_rows += 1

            if origin_label != current_origin:
                if origin_label in seen_origin_blocks:
                    origin_block_reentries += 1
                seen_origin_blocks.add(origin_label)
                current_origin = origin_label
                destinations_for_origin = set()
            if destination_label in destinations_for_origin:
                duplicate_pairs_within_origin += 1
            destinations_for_origin.add(destination_label)

            origin_state, origin_county, origin_fips = origin
            destination_state, destination_county, destination_fips = destination
            for fips, state, county in (
                (origin_fips, origin_state, origin_county),
                (destination_fips, destination_state, destination_county),
            ):
                existing = county_meta.get(fips)
                if existing is not None and existing != (state, county):
                    county_label_conflicts += 1
                else:
                    county_meta[fips] = (state, county)

            valid_row_count += 1
            total_observed += observed
            states.update((origin_state, destination_state))
            origin_counties.add(origin_fips)
            destination_counties.add(destination_fips)

            if origin_fips == destination_fips:
                intracounty_observed += observed
                continue

            county_outbound[origin_fips] += observed
            county_inbound[destination_fips] += observed

            if origin_state == destination_state:
                intrastate_cross_county_observed += observed
                state_intrastate[origin_state] += observed
            else:
                interstate_observed += observed
                state_interstate_out[origin_state] += observed
                state_interstate_in[destination_state] += observed
                directed_state_flows[(origin_state, destination_state)] += observed
                pair = tuple(sorted((origin_state, destination_state)))
                undirected_state_pairs[pair] += observed

    counties = []
    for fips, (state, county) in county_meta.items():
        inbound = county_inbound[fips]
        outbound = county_outbound[fips]
        counties.append(
            {
                "fips": fips,
                "state": state,
                "county": county,
                "inbound": inbound,
                "outbound": outbound,
                "total": inbound + outbound,
                "balance": inbound - outbound,
            }
        )
    counties.sort(key=lambda item: (-item["total"], item["fips"]))

    state_rows = []
    for state in sorted(states):
        interstate_in = state_interstate_in[state]
        interstate_out = state_interstate_out[state]
        state_rows.append(
            {
                "state": state,
                "interstateIn": interstate_in,
                "interstateOut": interstate_out,
                "interstateTotal": interstate_in + interstate_out,
                "intrastateCrossCounty": state_intrastate[state],
            }
        )

    state_flows = [
        {"source": source, "target": target, "value": value}
        for (source, target), value in directed_state_flows.items()
        if value > 0
    ]
    state_flows.sort(key=lambda item: (-item["value"], item["source"], item["target"]))

    state_pairs = [
        {"source": source, "target": target, "value": value}
        for (source, target), value in undirected_state_pairs.items()
        if value > 0
    ]
    state_pairs.sort(key=lambda item: (-item["value"], item["source"], item["target"]))

    result = {
        "meta": {
            "source": "Kang county traveler totals",
            "coverageStart": "2020-03-12",
            "coverageEnd": "2020-07-19",
            "grain": "county origin-destination pair aggregated over the full period",
            "unit": "cumulative observed travelers; not unique individuals",
            "rowCount": row_count,
            "validRowCount": valid_row_count,
            "countyCount": len(county_meta),
            "stateCount": len(states),
            "totalObserved": total_observed,
            "intracountyObserved": intracounty_observed,
            "intrastateCrossCountyObserved": intrastate_cross_county_observed,
            "interstateObserved": interstate_observed,
        },
        "quality": {
            "malformedRows": malformed_rows,
            "negativeValueRows": negative_value_rows,
            "zeroValueRows": zero_value_rows,
            "duplicatePairsWithinOrigin": duplicate_pairs_within_origin,
            "originBlockReentries": origin_block_reentries,
            "countyLabelConflicts": county_label_conflicts,
            "originCountyCount": len(origin_counties),
            "destinationCountyCount": len(destination_counties),
        },
        "states": state_rows,
        "stateFlows": state_flows,
        "statePairs": state_pairs,
        "counties": counties,
    }

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(result, separators=(",", ":"), ensure_ascii=False),
            encoding="utf-8",
        )
    return result


if __name__ == "__main__":
    target = Path(__file__).resolve().parents[1] / "public/data/mobility_legacy_2020.json"
    profile = profile_and_aggregate(DEFAULT_SOURCE, target)
    print(json.dumps({"meta": profile["meta"], "quality": profile["quality"]}, indent=2))
    print(f"Wrote {target}")
