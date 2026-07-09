#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
SCRIPT="${SCRIPT:-test_script.txt}"

echo "=== Video Pipeline HTTP API Demo ==="
echo "Base URL: $BASE"
echo "Script:   $SCRIPT"
echo

# ============================================================================
# 0. Health check
# ============================================================================
echo "→ Health check"
curl -sf "$BASE/health" | python3 -m json.tool
echo

# ============================================================================
# 1. Create pipeline
# ============================================================================
echo "→ Create pipeline (upload $SCRIPT)"
CREATE=$(curl -s -X POST -F "script=@$SCRIPT" "$BASE/pipelines")
echo "$CREATE" | python3 -m json.tool
PIPELINE_ID=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin)['pipeline_id'])")
echo "Pipeline ID: $PIPELINE_ID"
echo

# ============================================================================
# 2. Get pipeline status
# ============================================================================
echo "→ Get pipeline status"
curl -s "$BASE/pipelines/$PIPELINE_ID" | python3 -m json.tool
echo

# ============================================================================
# 3. Run Step 1: Storyboard
# ============================================================================
echo "→ Trigger Step 1 (storyboard)"
curl -s -X POST "$BASE/pipelines/$PIPELINE_ID/steps/1" | python3 -m json.tool
echo "Waiting for Step 1 to complete..."
for i in $(seq 1 12); do
    sleep 5
    STATUS=$(curl -s "$BASE/pipelines/$PIPELINE_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
    echo "  [$i] status=$STATUS"
    if [[ "$STATUS" == "step_2" || "$STATUS" == "done" ]]; then
        break
    fi
    if [[ "$STATUS" == "failed" ]]; then
        echo "Step 1 failed!"
        curl -s "$BASE/pipelines/$PIPELINE_ID" | python3 -m json.tool
        exit 1
    fi
done
echo

# ============================================================================
# 4. List artifacts
# ============================================================================
echo "→ List artifacts"
curl -s "$BASE/pipelines/$PIPELINE_ID/artifacts" | python3 -m json.tool
echo

# ============================================================================
# 5. Download storyboard.json
# ============================================================================
echo "→ Download storyboard.json (first 20 lines)"
curl -s "$BASE/pipelines/$PIPELINE_ID/artifacts/storyboard.json" | head -20
echo

# ============================================================================
# 6. Run Step 2: Assets
# ============================================================================
echo "→ Trigger Step 2 (assets)"
curl -s -X POST "$BASE/pipelines/$PIPELINE_ID/steps/2" | python3 -m json.tool
echo "Waiting for Step 2..."
for i in $(seq 1 8); do
    sleep 5
    STATUS=$(curl -s "$BASE/pipelines/$PIPELINE_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
    echo "  [$i] status=$STATUS"
    if [[ "$STATUS" == "step_3" || "$STATUS" == "done" ]]; then
        break
    fi
    if [[ "$STATUS" == "failed" ]]; then
        echo "Step 2 failed!"
        exit 1
    fi
done
echo

# ============================================================================
# 7. Run Step 3: Videos
# ============================================================================
echo "→ Trigger Step 3 (videos)"
curl -s -X POST "$BASE/pipelines/$PIPELINE_ID/steps/3" | python3 -m json.tool
echo "Waiting for Step 3 (this may take a while)..."
for i in $(seq 1 12); do
    sleep 10
    STATUS=$(curl -s "$BASE/pipelines/$PIPELINE_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
    echo "  [$i] status=$STATUS"
    if [[ "$STATUS" == "step_4" || "$STATUS" == "done" ]]; then
        break
    fi
    if [[ "$STATUS" == "failed" ]]; then
        echo "Step 3 failed!"
        exit 1
    fi
done
echo

# ============================================================================
# 8. Final status
# ============================================================================
echo "→ Final pipeline status"
curl -s "$BASE/pipelines/$PIPELINE_ID" | python3 -m json.tool
echo

echo "=== Demo complete ==="
echo "Pipeline ID: $PIPELINE_ID"
echo "To cleanup: curl -X DELETE $BASE/pipelines/$PIPELINE_ID"
