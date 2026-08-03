"""Create the reproducible Kang mobility profiling notebook with nbformat."""

from pathlib import Path
import nbformat as nbf


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_PATH = ROOT / "analysis/kang_mobility_data_quality.ipynb"

notebook = nbf.v4.new_notebook()
notebook["metadata"]["kernelspec"] = {
    "display_name": "Python 3",
    "language": "python",
    "name": "python3",
}
notebook["cells"] = [
    nbf.v4.new_markdown_cell(
        "# Kang County Mobility — Legacy Extract Audit\n\n"
        "## tl;dr\n\n"
        "This notebook audits the supplied March–July 2020 county origin–destination "
        "extract. The live Pandemic Atlas data is generated from the complete weekly "
        "archive by `prepare_kang_mobility_all.R`."
    ),
    nbf.v4.new_code_cell(
        "from pathlib import Path\n"
        "import json\n"
        "import sys\n\n"
        "ROOT = Path.cwd()\n"
        "if not (ROOT / 'app').exists():\n"
        "    ROOT = ROOT.parent\n"
        "sys.path.insert(0, str(ROOT / 'analysis'))\n"
        "from prepare_kang_mobility import DEFAULT_SOURCE, profile_and_aggregate\n\n"
        "OUTPUT = ROOT / 'public/data/mobility_legacy_2020.json'\n"
        "profile = profile_and_aggregate(DEFAULT_SOURCE, OUTPUT)\n"
        "meta = profile['meta']\n"
        "quality = profile['quality']\n"
        "print(f\"{meta['validRowCount']:,} valid OD rows across {meta['countyCount']:,} counties \"\n"
        "      f\"and {meta['stateCount']} state-level areas.\")\n"
        "print(f\"Coverage: {meta['coverageStart']} to {meta['coverageEnd']}; \"\n"
        "      f\"{meta['interstateObserved']:,} cumulative interstate observed travelers.\")\n"
        "print('Quality checks:', json.dumps(quality, indent=2))"
    ),
    nbf.v4.new_markdown_cell(
        "## Context & Methods\n\n"
        "The source contains one cumulative `observed_travelers` value per county "
        "origin–destination pair for March 12–July 19, 2020. Values are additive "
        "observations over the period and must not be interpreted as unique people.\n\n"
        "### Key Assumptions\n\n"
        "- Labels follow `State | County | FIPS`.\n"
        "- County pairs are grouped by origin, enabling bounded duplicate checks.\n"
        "- Inbound/outbound county metrics exclude within-county observations.\n"
        "- Interstate flow-wheel values combine both directions for each state pair."
    ),
    nbf.v4.new_markdown_cell("## Data\n\n### Compact source and quality profile"),
    nbf.v4.new_code_cell(
        "summary = {**meta, **quality}\n"
        "for key, value in summary.items():\n"
        "    print(f\"{key}: {value:,}\" if isinstance(value, int) else f\"{key}: {value}\")"
    ),
    nbf.v4.new_markdown_cell("## Results\n\n### Highest-volume interstate pairs and county hubs"),
    nbf.v4.new_code_cell(
        "print('Top interstate pairs:')\n"
        "for row in profile['statePairs'][:10]:\n"
        "    print(f\"{row['source']} ↔ {row['target']}: {row['value']:,}\")\n\n"
        "print('\\nTop cross-county hubs:')\n"
        "for row in profile['counties'][:10]:\n"
        "    print(f\"{row['county']}, {row['state']}: {row['total']:,}\")"
    ),
    nbf.v4.new_markdown_cell(
        "## Takeaways\n\n"
        "- The web figures should use state-pair totals and county cross-county "
        "inbound/outbound totals, not a time-series encoding.\n"
        "- Within-county observations are preserved in the profile but excluded from "
        "the county hub comparison.\n"
        "- The published interface must label the date window and state that totals "
        "are cumulative observations rather than unique individuals."
    ),
]

nbf.write(notebook, NOTEBOOK_PATH)
print(NOTEBOOK_PATH)
