#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
ID="${1:?Usage: $0 <pipeline_id>}"

curl -s -X DELETE "$BASE/pipelines/$ID" -o /dev/null -w "%{http_code}\n"
