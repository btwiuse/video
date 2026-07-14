#!/usr/bin/env python3
"""Generate a gentle landscape via StepFun, then run TokenVoke i2v.

Usage:
    python scripts/test_stepfun_i2v.py [--duration 4] [--tunnel-url URL]
"""

import argparse
import os
import sys
import tempfile
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

TOKENVOKE_BASE = os.getenv("TOKENVOKE_BASE_URL", "https://overseas.tokenvoke.com").rstrip("/")
VIDEO_API_KEY = os.getenv("VIDEO_API_KEY", "")
VIDEO_MODEL = os.getenv("VIDEO_MODEL", "doubao-seedance-2-0-fast-260128")
STEPFUN_API_KEY = os.getenv("STEPFUN_API_KEY", "") or os.getenv("IMAGE_API_KEY", "")
STEPFUN_MODEL = os.getenv("STEPFUN_MODEL", "step-image-edit-2")
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./output"))

# Size for step-image-edit-2: "height x width" (note order!)
SIZE = "768x1360"  # 16:9 landscape


def main():
    parser = argparse.ArgumentParser(description="StepFun image + TokenVoke i2v")
    parser.add_argument("--duration", type=int, default=4, help="Video duration in seconds (4-10)")
    parser.add_argument("--tunnel-url", default=os.getenv("TUNNEL_URL", ""), help="Public tunnel URL")
    args = parser.parse_args()

    duration = max(4, min(10, args.duration))
    tunnel_url = args.tunnel_url.rstrip("/")

    if not tunnel_url:
        print("ERROR: --tunnel-url or TUNNEL_URL required", file=sys.stderr)
        sys.exit(1)
    if not VIDEO_API_KEY:
        print("ERROR: VIDEO_API_KEY not set", file=sys.stderr)
        sys.exit(1)
    if not STEPFUN_API_KEY:
        print("ERROR: STEPFUN_API_KEY / IMAGE_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    # Step 1: Generate gentle landscape via StepFun
    print("=== Step 1: Generate gentle landscape via StepFun ===")
    prompt = (
        "A peaceful mountain lake at golden hour, calm water reflecting "
        "snow-capped peaks, gentle breeze, pine trees on shore, soft clouds, "
        "cinematic photography, highly detailed, warm lighting"
    )
    body = {
        "model": STEPFUN_MODEL,
        "prompt": prompt[:512],
        "size": SIZE,
        "response_format": "url",
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {STEPFUN_API_KEY}",
    }

    with httpx.Client(timeout=120) as client:
        resp = client.post("https://api.stepfun.com/v1/images/generations", headers=headers, json=body)
        if resp.status_code != 200:
            print(f"StepFun error: HTTP {resp.status_code}: {resp.text[:500]}")
            sys.exit(1)
        data = resp.json()
        images = data.get("data", [])
        if not images:
            print(f"StepFun error: no images in response: {data}")
            sys.exit(1)
        image_url = images[0].get("url", "")
        if not image_url:
            print(f"StepFun error: no URL: {images[0]}")
            sys.exit(1)
        print(f"  Image URL: {image_url}")

        # Download to temp
        fd, img_path = tempfile.mkstemp(suffix=".jpg", prefix="stepfun_gentle_")
        os.close(fd)
        dl = client.get(image_url)
        if dl.status_code != 200:
            print(f"Download failed: HTTP {dl.status_code}")
            os.unlink(img_path)
            sys.exit(1)
        with open(img_path, "wb") as f:
            f.write(dl.content)
        img_size = os.path.getsize(img_path)
        print(f"  Saved to: {img_path} ({img_size} bytes)")

    # Step 2: Upload via tunnel & run i2v
    print("\n=== Step 2: Run TokenVoke i2v ===")
    image_abs = os.path.abspath(img_path)
    project_root = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
    # The image is in temp dir, not under project root. Copy to output dir.
    import shutil
    local_copy = os.path.join(OUTPUT_DIR, "_stepfun_test_input.jpg")
    shutil.copy2(img_path, local_copy)
    print(f"  Copied to: {local_copy}")

    # Construct public URL relative to project root
    rel_path = os.path.relpath(local_copy, project_root)
    public_image_url = f"{tunnel_url}/{rel_path}"

    # Verify
    r = httpx.get(public_image_url, timeout=10)
    if r.status_code != 200:
        print(f"WARN: public URL returned HTTP {r.status_code}")
    else:
        print(f"  Public URL: {public_image_url}")
        print(f"  Content-Type: {r.headers.get('content-type', '?')}")

    vheaders = {
        "Authorization": f"Bearer {VIDEO_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": VIDEO_MODEL,
        "prompt": "Continue this peaceful landscape scene, gentle slow motion, cinematic, 16:9, 720p",
        "duration": duration,
        "metadata": {"ratio": "16:9", "resolution": "720p"},
        "images": [public_image_url],
    }

    with httpx.Client(timeout=900) as client:
        print(f"\n  Creating task (duration={duration}s)...")
        resp = client.post(f"{TOKENVOKE_BASE}/v1/video/generations", headers=vheaders, json=body)
        if resp.status_code != 200:
            print(f"Create task HTTP {resp.status_code}: {resp.text[:500]}")
            sys.exit(1)
        task_id = (resp.json().get("task_id") or resp.json().get("id"))
        print(f"  task_id = {task_id}")

        elapsed = 0
        while True:
            time.sleep(5)
            elapsed += 5
            poll = client.get(f"{TOKENVOKE_BASE}/v1/video/generations/{task_id}", headers=vheaders)
            if poll.status_code != 200:
                continue
            result = poll.json()
            d = result.get("data", result) if result.get("code") == "success" else result
            status = (d.get("status") or "").upper()
            progress = d.get("progress", "")
            print(f"  [{elapsed:3d}s] status={status}  progress={progress}")

            if status in ("SUCCESS", "COMPLETED"):
                video_url = d.get("result_url") or d.get("video_url", "")
                print(f"\n  Downloading...")
                dl = client.get(video_url)
                if dl.status_code != 200:
                    print(f"Download HTTP {dl.status_code}")
                    sys.exit(1)
                out_path = OUTPUT_DIR / "test_i2v.mp4"
                OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                out_path.write_bytes(dl.content)
                print(f"  Done! Saved to: {out_path} ({len(dl.content)} bytes)")
                sys.exit(0)

            if status in ("FAILURE", "FAILED", "EXPIRED", "CANCELLED"):
                reason = d.get("fail_reason", d.get("error", d.get("message", str(d))))
                print(f"  FAILED: {reason}")
                sys.exit(1)


if __name__ == "__main__":
    main()
