#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
SCRIPT="${1:-test_script.txt}"

if [[ ! -f "$SCRIPT" ]]; then
    echo "Error: script file '$SCRIPT' not found"
    exit 1
fi

curl -s -X POST -F "script=@$SCRIPT" "$BASE/pipelines" | python3 -m json.tool
