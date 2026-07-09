#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
ID="${1:?Usage: $0 <pipeline_id> [artifact_name]}"

if [[ $# -ge 2 ]]; then
    # Download single artifact
    curl -s "$BASE/pipelines/$ID/artifacts/$2"
else
    # List artifacts
    curl -s "$BASE/pipelines/$ID/artifacts" | python3 -m json.tool
fi
