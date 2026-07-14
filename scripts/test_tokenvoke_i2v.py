#!/usr/bin/env python3
"""Manual test: TokenVoke Seedance image-to-video (图生视频).

Shares the local image via a Python HTTP server + ufo tunnel to get a public URL,
then sends it to TokenVoke/Seedance for video generation.

Usage:
    python scripts/test_tokenvoke_i2v.py <path_to_image> [--tunnel-url TUNNEL_URL]

The tunnel URL must be a ufo.k0s.io URL forwarding to a Python HTTP server
running in the project root (so the image is accessible by relative path).
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

TOKENVOKE_BASE = os.getenv("TOKENVOKE_BASE_URL", "https://overseas.tokenvoke.com").rstrip("/")
API_KEY = os.getenv("VIDEO_API_KEY", "")
MODEL = os.getenv("VIDEO_MODEL", "doubao-seedance-2-0-fast-260128")
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./output"))


def main():
    if not API_KEY:
        print("ERROR: VIDEO_API_KEY not set in .env")
        sys.exit(1)

    if len(sys.argv) < 2:
        print("Usage: python scripts/test_tokenvoke_i2v.py <image_path> [--tunnel-url URL]")
        sys.exit(1)

    image_path = sys.argv[1]
    tunnel_url = None
    if "--tunnel-url" in sys.argv:
        idx = sys.argv.index("--tunnel-url")
        tunnel_url = sys.argv[idx + 1].rstrip("/")

    if not tunnel_url:
        tunnel_url = os.getenv("TUNNEL_URL", "").rstrip("/")
    if not tunnel_url:
        print("ERROR: provide --tunnel-url or set TUNNEL_URL in .env")
        sys.exit(1)

    if not os.path.isfile(image_path):
        print(f"ERROR: image not found: {image_path}")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }

    # Construct public URL from local path (Python HTTP server serves from project root)
    image_abs = os.path.abspath(image_path)
    project_root = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
    rel_path = os.path.relpath(image_abs, project_root)
    image_url = f"{tunnel_url}/{rel_path}"

    print(f"[1/3] Image URL: {image_url}")
    print(f"  File: {image_path} ({os.path.getsize(image_path)} bytes)")

    # Verify the public URL is reachable
    r = httpx.get(image_url, timeout=10)
    if r.status_code != 200:
        print(f"WARN: public URL returned HTTP {r.status_code}, but continuing...")
    else:
        print(f"  Content-Type: {r.headers.get('content-type', '?')}")

    body = {
        "model": MODEL,
        "prompt": "A cinematic shot of this scene, gentle camera movement, high quality, 720p",
        "duration": 5,
        "metadata": {
            "ratio": "16:9",
            "resolution": "720p",
        },
        "images": [image_url],
    }

    print(f"  Model:      {MODEL}")
    print(f"  Endpoint:   {TOKENVOKE_BASE}/v1/video/generations")
    print(f"  Prompt:     {body['prompt']}")
    print(f"  Duration:   {body['duration']}s")
    print()

    with httpx.Client(timeout=900) as client:
        # --- Step 2: Create task ---
        print("[2/3] Creating video generation task...")
        resp = client.post(f"{TOKENVOKE_BASE}/v1/video/generations", headers=headers, json=body)

        if resp.status_code != 200:
            print(f"ERROR: Create task HTTP {resp.status_code}")
            print(resp.text[:1000])
            sys.exit(1)

        data = resp.json()
        task_id = data.get("task_id") or data.get("id")
        print(f"  task_id = {task_id}")
        print(f"  raw response: {json.dumps(data, indent=2, ensure_ascii=False)[:500]}")
        print()

        if not task_id:
            print("ERROR: no task_id in response")
            sys.exit(1)

        # --- Step 3: Poll ---
        print("[3/3] Polling for completion...")
        poll_url = f"{TOKENVOKE_BASE}/v1/video/generations/{task_id}"
        video_url = None
        elapsed = 0

        while True:
            time.sleep(5)
            elapsed += 5
            poll = client.get(poll_url, headers=headers)

            if poll.status_code != 200:
                print(f"  WARN: poll HTTP {poll.status_code}, retrying...")
                continue

            result = poll.json()
            # TokenVoke response: {code:"success", data:{status, progress, result_url?, ...}}
            d = result.get("data", result) if result.get("code") == "success" else result
            status = (d.get("status") or "").upper()
            progress = d.get("progress", "")
            print(f"  [{elapsed:3d}s] status={status}  progress={progress}")

            if status in ("SUCCESS", "COMPLETED"):
                video_url = d.get("result_url") or d.get("video_url", "")
                break
            elif status in ("FAILURE", "FAILED", "EXPIRED", "CANCELLED"):
                reason = d.get("fail_reason", d.get("error", d.get("message", str(d))))
                print(f"ERROR: generation failed: {reason}")
                sys.exit(1)
            # else keep polling (NOT_START, IN_PROGRESS, PROCESSING, QUEUED, PENDING, RUNNING)

        # --- Step 4: Download ---
        print(f"\nDownloading video...")
        print(f"  url: {video_url}")
        if not video_url:
            print("ERROR: no video_url in response")
            sys.exit(1)

        dl = client.get(video_url)
        if dl.status_code != 200:
            print(f"ERROR: download HTTP {dl.status_code}")
            sys.exit(1)

        output_dir = OUTPUT_DIR
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "test_i2v.mp4"
        output_path.write_bytes(dl.content)
        print(f"\nDone! Video saved to: {output_path} ({len(dl.content)} bytes)")


if __name__ == "__main__":
    main()


if __name__ == "__main__":
    main()
