"""
Step 3: Video generation via pluggable video providers.

Architecture: Provider abstraction → easy swap between video models.

Current providers:
  - Seedance 2.0 (Volcengine Ark) — multimodal content with reference images
  - Null — saves prompt, no API call (for testing)
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("step3")

import httpx

from config import config
from src.prompts import assemble_video_prompt
from src.utils import ensure_output_dir, save_json, load_json


# ============================================================================
# Result type
# ============================================================================

@dataclass
class VideoResult:
    """Result of a single video generation."""
    shot_id: str
    path: str
    status: str = "pending"       # "done" | "failed" | "pending"
    url: str = ""
    error: str = ""


# ============================================================================
# Abstract Provider Interface
# ============================================================================

class VideoProvider(ABC):
    """Abstract interface for video generation backends.

    To add a new video model, subclass this and implement generate().
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider name, e.g. 'Seedance 2.0 (Volcengine Ark)'."""

    @abstractmethod
    async def generate(
        self,
        shot_id: str,
        prompt: str,
        start_frame_path: str,
        ref_image_paths: list[str],
        duration: float,
        output_path: str,
    ) -> VideoResult:
        """Generate one video clip. Returns VideoResult with path to downloaded file."""


# ============================================================================
# Seedance 2.0 (Volcengine Ark)
# ============================================================================

class SeedanceProvider(VideoProvider):
    """Seedance 2.0 video generation via Volcano Ark REST API.

    API docs: https://www.volcengine.com/docs/82379/1520757
    """

    ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3"

    def __init__(self):
        self._model = config.SEEDANCE_MODEL
        self._headers = {
            "Authorization": f"Bearer {config.VIDEO_API_KEY}",
            "Content-Type": "application/json",
        }

    @property
    def name(self) -> str:
        return f"Seedance 2.0 ({self._model})"

    async def generate(
        self,
        shot_id: str,
        prompt: str,
        start_frame_path: str,
        ref_image_paths: list[str],
        duration: float,
        output_path: str,
    ) -> VideoResult:
        """Single Seedance 2.0 generation via Ark task API."""
        content: list[dict] = [{"type": "text", "text": prompt}]

        # r2v mode: all images (start frame + refs) as reference_image
        all_images = ([start_frame_path] if start_frame_path else []) + ref_image_paths
        for path in all_images:
            url = self._file_to_data_url(path)
            if url:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": url},
                    "role": "reference_image",
                })

        body = {
            "model": self._model,
            "content": content,
            "resolution": "480p",
            "ratio": "16:9",
            "duration": self._normalize_duration(int(duration)),
            "watermark": False,
        }

        async with httpx.AsyncClient(timeout=900) as client:
            # 1. Create task (retry on 403 and 400 content moderation errors)
            task_id = None
            last_error = ""
            for attempt in range(10):
                resp = await client.post(
                    f"{self.ARK_BASE}/contents/generations/tasks",
                    headers=self._headers,
                    json=body,
                )
                if resp.status_code == 200:
                    task_id = resp.json()["id"]
                    break
                if resp.status_code in (403, 400):
                    last_error = resp.text[:500]
                    await asyncio.sleep(2 ** attempt)
                    continue
                return VideoResult(
                    shot_id=shot_id, path=output_path, status="failed",
                    error=f"Create task HTTP {resp.status_code}: {resp.text[:500]}",
                )
            if task_id is None:
                return VideoResult(
                    shot_id=shot_id, path=output_path, status="failed",
                    error=f"Create task failed after 10 retries: {last_error}",
                )

            # 2. Poll until complete (retry 403 on poll)
            poll_failures = 0
            poll_elapsed = 0
            while True:
                await asyncio.sleep(5)
                poll_elapsed += 5
                logger.info("  poll %s: waiting %ds...", shot_id, poll_elapsed)
                poll = await client.get(
                    f"{self.ARK_BASE}/contents/generations/tasks/{task_id}",
                    headers=self._headers,
                )
                if poll.status_code == 403:
                    poll_failures += 1
                    if poll_failures >= 10:
                        return VideoResult(
                            shot_id=shot_id, path=output_path, status="failed",
                            error="Poll failed after 10 retries (403)",
                        )
                    continue
                poll_failures = 0
                if poll.status_code != 200:
                    return VideoResult(
                        shot_id=shot_id, path=output_path, status="failed",
                        error=f"Poll HTTP {poll.status_code}",
                    )
                result = poll.json()
                status = result.get("status")
                if status == "succeeded":
                    video_url = result["content"]["video_url"]
                    # Download with retry on 403
                    dl = None
                    for dl_attempt in range(3):
                        dl = await client.get(video_url)
                        if dl.status_code == 403:
                            await asyncio.sleep(2 ** dl_attempt)
                            continue
                        break
                    if dl is None or dl.status_code == 403:
                        return VideoResult(
                            shot_id=shot_id, path=output_path, status="failed",
                            error="Download failed after 3 retries (403)",
                        )
                    if dl.status_code != 200:
                        return VideoResult(
                            shot_id=shot_id, path=output_path, status="failed",
                            error=f"Download HTTP {dl.status_code}",
                        )
                    with open(output_path, "wb") as f:
                        f.write(dl.content)
                    return VideoResult(
                        shot_id=shot_id, path=output_path,
                        status="done", url=video_url,
                    )
                if status in ("failed", "expired", "cancelled"):
                    return VideoResult(
                        shot_id=shot_id, path=output_path,
                        status=status,
                        error=str(result.get("error", result.get("message", ""))),
                    )

    @staticmethod
    def _file_to_data_url(path: str) -> str | None:
        """Convert local image to base64 data URL for the API."""
        if not path or not os.path.isfile(path):
            return None
        try:
            ext = os.path.splitext(path)[1].lower().lstrip(".")
            mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp"}.get(ext, "png")
            with open(path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            return f"data:image/{mime};base64,{b64}"
        except Exception:
            return None

    @staticmethod
    def _normalize_duration(duration_sec: int) -> int:
        """Clamp duration to API valid range [4, 10] for r2v/i2v."""
        return max(4, min(10, duration_sec))


# ============================================================================
# Null Provider (testing)
# ============================================================================

class NullVideoProvider(VideoProvider):
    """Fallback: saves prompt to file, does not call any API. For testing."""

    @property
    def name(self) -> str:
        return "Null (prompts only)"

    async def generate(
        self,
        shot_id: str,
        prompt: str,
        start_frame_path: str,
        ref_image_paths: list[str],
        duration: float,
        output_path: str,
    ) -> VideoResult:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        txt_path = output_path.rsplit(".", 1)[0] + "_prompt.txt"
        with open(txt_path, "w") as f:
            f.write(prompt)
        return VideoResult(
            shot_id=shot_id, path=output_path, status="pending",
            url="", error="",
        )


# ============================================================================
# Provider Factory
# ============================================================================

_PROVIDER_REGISTRY: dict[str, type[VideoProvider]] = {
    "seedance": SeedanceProvider,
    "null": NullVideoProvider,
}


def create_video_provider(provider_name: str | None = None) -> VideoProvider:
    """Create a video provider from config or explicit name.

    Set VIDEO_PROVIDER in .env to one of: seedance, null
    """
    name = provider_name or config.VIDEO_PROVIDER
    cls = _PROVIDER_REGISTRY.get(name)
    if cls is None:
        raise ValueError(
            f"Unknown video provider '{name}'. Available: {list(_PROVIDER_REGISTRY.keys())}"
        )
    return cls()


def list_video_providers() -> list[str]:
    """Return list of available video provider names."""
    return list(_PROVIDER_REGISTRY.keys())


# ============================================================================
# Pipeline: orchestrates shot iteration, dep resolution, candidate generation
# ============================================================================

class VideoPipeline:
    """Orchestrates video generation using any VideoProvider."""

    def __init__(self, provider: VideoProvider | None = None):
        self.provider = provider or create_video_provider()
        self.max_images = config.SEEDANCE_MAX_IMAGES

    async def generate_all_shots(
        self, storyboard: dict, asset_manifest: dict
    ) -> list[dict]:
        """Generate video clips for all shots."""
        print(f"  Video provider: {self.provider.name}")

        shots = storyboard.get("shots", [])
        timeline = self._build_timeline(shots)
        results = []

        for i, shot in enumerate(shots):
            shot_id = shot["full_shot_id"]
            transition = shot.get("transition_type", "B")

            print(f"  Shot {shot_id} ({i+1}/{len(shots)}) [{transition}]")

            # Read deps.json for character/scene references
            deps = load_json(str(ensure_output_dir("shots", shot_id) / "deps.json"))
            char_ref_ids = deps.get("character_refs", [])
            scene_id = deps.get("scene_id", self._get_scene_id(shot))

            # Read full .md as the complete prompt
            prompt = self._read_shot_md(shot_id)
            if not prompt:
                prompt = assemble_video_prompt(shot)

            start_frame, ref_images = self._resolve_image_refs(
                shot_id, char_ref_ids, scene_id, transition, asset_manifest, i, shots
            )

            result = await self._generate_single(
                shot_id, prompt, start_frame, ref_images,
                shot.get("duration_sec", 5),
            )
            result["start_sec"] = timeline[i]["start_sec"]
            result["end_sec"] = timeline[i]["end_sec"]
            result["transition_type"] = transition
            results.append(result)

        manifest = self._build_clip_manifest(results)
        save_json(manifest, str(ensure_output_dir() / "clip_manifest.json"))
        return manifest

    # ========================================================================
    # .md extraction
    # ========================================================================

    @staticmethod
    def _read_shot_md(shot_id: str) -> str:
        """Read the full shot markdown file as the video generation prompt."""
        md_path = ensure_output_dir("shots", shot_id) / f"{shot_id}.md"
        if not md_path.is_file():
            return ""
        return md_path.read_text(encoding="utf-8")

    # ========================================================================
    # Candidate generation
    # ========================================================================

    async def _generate_single(
        self, shot_id, prompt, start_frame, ref_images, duration,
    ) -> dict:
        import os as _os
        output_path = str(ensure_output_dir("shots", shot_id) / f"{shot_id}.mp4")
        if _os.path.isfile(output_path):
            return {"shot_id": shot_id, "path": output_path, "status": "done", "url": "", "error": ""}
        r = await self.provider.generate(
            shot_id, prompt, start_frame, ref_images,
            duration, output_path,
        )
        return self._result_to_dict(r)

    @staticmethod
    def _result_to_dict(r: VideoResult) -> dict:
        return {
            "shot_id": r.shot_id,
            "path": r.path,
            "status": r.status,
            "url": r.url,
            "error": r.error,
        }

    # ========================================================================
    # Image reference resolution
    # ========================================================================

    def _resolve_image_refs(
        self, shot_id: str, char_ref_ids: list[str], scene_id: str,
        transition_type: str, manifest: dict, shot_index: int, all_shots: list,
    ) -> tuple[str, list[str]]:
        """Resolve start frame and reference images. Returns (start_frame_path, ref_paths)."""
        refs: list[str] = []
        quota = self.max_images

        # 1. This shot's start frame
        sf_path = str(ensure_output_dir("shots", shot_id) / f"{shot_id}_startframe.png")
        if not os.path.isfile(sf_path):
            sf_path = ""

        # 2. Character portraits
        char_entries = self._get_char_entries(char_ref_ids, manifest)
        per_char = min(2, quota // max(len(char_entries), 1))
        for char_key in char_entries:
            for suffix in ("_front", "_profile", "_fullbody"):
                label = f"{char_key}{suffix}"
                if label in manifest and manifest[label].get("file"):
                    refs.append(manifest[label]["file"])
                    if sum(1 for r in refs if char_key in str(r)) >= per_char:
                        break
            if len(refs) >= quota - 2:
                break

        # 3. Scene reference
        for suffix in ("_wide", "_detail"):
            label = f"{scene_id}{suffix}"
            if label in manifest and manifest[label].get("file"):
                refs.append(manifest[label]["file"])
                break
        if len(refs) >= quota:
            return sf_path, refs[:quota]

        # 4. Previous shot's start frame for Type A continuity
        if transition_type == "A" and shot_index > 0:
            prev_id = all_shots[shot_index - 1].get("full_shot_id", "")
            prev_sf = str(ensure_output_dir("shots", prev_id) / f"{prev_id}_startframe.png")
            if os.path.isfile(prev_sf):
                refs.append(prev_sf)

        return sf_path, refs[:quota]

    @staticmethod
    def _get_char_entries(char_ref_ids: list[str], manifest: dict) -> dict:
        """Map character ref IDs to manifest keys."""
        chars = {}
        for ref in char_ref_ids:
            if ref in manifest:
                chars[ref] = manifest[ref]
            else:
                for key, info in manifest.items():
                    if info.get("type") == "character" and info.get("character_name") == ref:
                        chars[info.get("character_id", key)] = info
                        break
        if not chars:
            for key, info in manifest.items():
                if info.get("type") == "character":
                    chars[info.get("character_id", key)] = info
        return chars

    # ========================================================================
    # Helpers
    # ========================================================================

    @staticmethod
    def _get_scene_id(shot: dict) -> str:
        """Parse scene_id from full_shot_id: 'SC01_SHOT02' -> 'SC01'."""
        sid = shot.get("full_shot_id", "")
        parts = sid.split("_")
        return parts[0] if parts else ""

    @staticmethod
    def _build_timeline(shots: list[dict]) -> list[dict]:
        timeline = []
        t = 0.0
        for s in shots:
            d = s.get("duration_sec", 5)
            timeline.append({
                "shot_id": s.get("full_shot_id", f"SHOT{t:.0f}"),
                "start_sec": t,
                "end_sec": t + d,
            })
            t += d
        return timeline

    @staticmethod
    def _build_clip_manifest(results: list[dict]) -> list[dict]:
        return [
            {
                "shot_id": r["shot_id"],
                "file": r.get("path"),
                "status": r.get("status"),
                "start_sec": r.get("start_sec"),
                "end_sec": r.get("end_sec"),
                "transition_type": r.get("transition_type"),
                "error": r.get("error", ""),
            }
            for r in results
        ]


# ============================================================================
# Convenience
# ============================================================================

async def generate_videos(
    storyboard_path: str, manifest_path: str, provider_name: str | None = None,
) -> list[dict]:
    """Convenience: storyboard JSON + asset manifest -> clip manifest."""
    storyboard = load_json(storyboard_path)
    manifest = load_json(manifest_path)
    provider = create_video_provider(provider_name)
    pipeline = VideoPipeline(provider)
    return await pipeline.generate_all_shots(storyboard, manifest)
