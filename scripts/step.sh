#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
ID="${1:?Usage: $0 <pipeline_id> <step>}"
STEP="${2:?Usage: $0 <pipeline_id> <step>}"

if [[ "$STEP" -lt 1 || "$STEP" -gt 5 ]]; then
    echo "Error: step must be 1-5"
    exit 1
fi

curl -s -X POST "$BASE/pipelines/$ID/steps/$STEP" | python3 -m json.tool
