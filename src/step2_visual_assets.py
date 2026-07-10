"""
Step 2: Visual asset generation.

Generates character portraits (3 angles) and scene reference images.

Architecture: Provider abstraction → easy swap between image models.
"""

from __future__ import annotations

import asyncio
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

import httpx

from config import config
from src.prompts import (
    CHARACTER_PORTRAIT_FRONT,
    CHARACTER_PORTRAIT_PROFILE,
    CHARACTER_FULL_BODY,
    SCENE_REFERENCE_WIDE,
    SCENE_REFERENCE_DETAIL,
)
from src.utils import ensure_output_dir, save_json, load_json

logger = logging.getLogger("step2")


# ============================================================================
# Result types
# ============================================================================

@dataclass
class ImageResult:
    """Result of a single image generation."""
    label: str
    path: str
    prompt: str
    status: str = "pending"       # "done" | "failed" | "pending"
    url: str = ""
    error: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


# ============================================================================
# Abstract Provider Interface
# ============================================================================

class ImageProvider(ABC):
    """Abstract interface for image generation backends.

    To add a new image model, subclass this and implement generate().
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider name, e.g. 'Flux 1.1 Pro (Replicate)'."""

    @abstractmethod
    async def generate(self, prompt: str, aspect_ratio: str = "4:3") -> ImageResult:
        """Generate one image. Returns ImageResult with path to downloaded file."""

    async def generate_batch(
        self, prompts_and_labels: list[tuple[str, str, str]]
    ) -> list[ImageResult]:
        """Generate multiple images sequentially."""
        out = []
        for prompt, label, ar in prompts_and_labels:
            r = await self.generate(prompt, ar)
            r.label = label
            out.append(r)
        return out


# ============================================================================
# Replicate-based Providers
# ============================================================================

class ReplicateProvider(ImageProvider):
    """Base for providers using Replicate API."""

    base_url: str = "https://api.replicate.com/v1/predictions"
    model_version: str = ""          # e.g. "black-forest-labs/flux-1.1-pro"
    default_aspect: str = "4:3"
    output_format: str = "png"
    poll_interval: float = 2.0

    def __init__(self, out_dir: str | None = None):
        self._out_dir = out_dir or str(ensure_output_dir())
        self._token = config.IMAGE_API_KEY
        self._headers = {"Authorization": f"Token {self._token}"}

    @property
    @abstractmethod
    def name(self) -> str: ...

    async def generate(self, prompt: str, aspect_ratio: str = "") -> ImageResult:
        ar = aspect_ratio or self.default_aspect
        os.makedirs(self._out_dir, exist_ok=True)

        async with httpx.AsyncClient(timeout=300) as client:
            # Submit prediction
            resp = await client.post(
                self.base_url,
                headers=self._headers,
                json={
                    "version": self.model_version,
                    "input": {
                        "prompt": prompt,
                        "aspect_ratio": ar,
                        "output_format": self.output_format,
                        **self._extra_inputs(),
                    },
                },
            )
            resp.raise_for_status()
            prediction = resp.json()

            # Poll until complete
            get_url = prediction["urls"]["get"]
            while prediction["status"] not in ("succeeded", "failed", "canceled"):
                await asyncio.sleep(self.poll_interval)
                poll_resp = await client.get(get_url, headers=self._headers)
                poll_resp.raise_for_status()
                prediction = poll_resp.json()

            if prediction["status"] != "succeeded":
                return ImageResult(
                    label="", path="", prompt=prompt,
                    status="failed", error=prediction.get("error", "unknown"),
                )

            # Download
            image_url = prediction["output"]
            # Build filename from prompt hash for de-duplication
            import hashlib
            name_hash = hashlib.md5(prompt.encode()).hexdigest()[:12]
            filepath = os.path.join(self._out_dir, f"{name_hash}.{self.output_format}")

            dl_resp = await client.get(image_url)
            dl_resp.raise_for_status()
            with open(filepath, "wb") as f:
                f.write(dl_resp.content)

            return ImageResult(
                label="", path=filepath, prompt=prompt, status="done",
                url=image_url, metadata={"model": self.model_version},
            )

    def _extra_inputs(self) -> dict:
        """Override in subclass for model-specific parameters."""
        return {}


# ---- Concrete Replicate Providers ----

class Flux11ProProvider(ReplicateProvider):
    """Flux 1.1 Pro — best realism, good spatial understanding."""
    model_version = "black-forest-labs/flux-1.1-pro"
    default_aspect = "4:3"

    @property
    def name(self) -> str:
        return "Flux 1.1 Pro (Replicate)"


class Flux11ProUltraProvider(ReplicateProvider):
    """Flux 1.1 Pro Ultra — higher quality, slower."""
    model_version = "black-forest-labs/flux-1.1-pro-ultra"
    default_aspect = "4:3"
    poll_interval = 4.0

    @property
    def name(self) -> str:
        return "Flux 1.1 Pro Ultra (Replicate)"


class SDXLProvider(ReplicateProvider):
    """SDXL — fast, cheaper, decent for bulk generation."""
    model_version = "stability-ai/sdxl"
    default_aspect = "4:3"

    @property
    def name(self) -> str:
        return "SDXL (Replicate)"

    def _extra_inputs(self) -> dict:
        return {
            "negative_prompt": "blurry, low quality, distorted face, bad anatomy, cartoon, CGI",
            "num_inference_steps": 30,
        }


# ---- Seedream (Volcengine / ByteDance) ----

class SeedreamProvider(ImageProvider):
    """Seedream via Volcengine Ark API.

    Features:
      - Native Chinese prompt support (no translation needed)
      - Up to 14 reference images for character/scene consistency
      - Supports 2K/3K/4K resolution
      - Sequential image generation for consistent multi-shot outputs

    API docs: https://www.volcengine.com/docs/82379/1541523
    """

    endpoint: str = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
    model_id: str = "doubao-seedream-5-0-260128"
    default_size: str = "2K"

    def __init__(self):
        self._api_key = config.IMAGE_API_KEY
        self._headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._api_key}",
        }

    @property
    def name(self) -> str:
        return "Seedream 5.0 (Volcengine)"

    async def generate(
        self,
        prompt: str,
        aspect_ratio: str = "4:3",
        reference_images: list[str] | None = None,   # URLs or base64 of reference images
        watermark: bool = False,
        num_images: int = 1,
    ) -> ImageResult:
        """Generate a single image via Seedream API.

        Args:
            prompt: Text prompt (Chinese or English)
            aspect_ratio: e.g. "4:3", "16:9", "1:1"
            reference_images: Optional list of image URLs/base64 for character anchoring
            watermark: Whether to include watermark (default False)
            num_images: Number of images to generate (1-15)
        """
        body: dict[str, Any] = {
            "model": self.model_id,
            "prompt": prompt,
            "size": self._aspect_to_size(aspect_ratio),
            "output_format": "png",
            "watermark": watermark,
            "max_images": num_images,
        }

        if reference_images:
            data_urls = [self._to_data_url(p) for p in reference_images]
            data_urls = [u for u in data_urls if u]  # filter out failures
            if data_urls:
                body["image"] = data_urls if len(data_urls) > 1 else data_urls[0]

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(self.endpoint, headers=self._headers, json=body)

            if resp.status_code != 200:
                return ImageResult(
                    label="", path="", prompt=prompt, status="failed",
                    error=f"HTTP {resp.status_code}: {resp.text[:500]}",
                )

            data = resp.json()
            images_data = data.get("data", [])
            if not images_data:
                return ImageResult(
                    label="", path="", prompt=prompt, status="failed",
                    error=f"No image data in response: {data}",
                )

            # Download first image
            image_url = images_data[0].get("url", "")
            if not image_url:
                return ImageResult(
                    label="", path="", prompt=prompt, status="failed",
                    error="No URL in response data",
                )

            import hashlib
            import tempfile
            name_hash = hashlib.md5(prompt.encode()).hexdigest()[:12]
            fd, filepath = tempfile.mkstemp(suffix=".png", prefix=f"seedream_{name_hash}_")
            os.close(fd)

            dl_resp = await client.get(image_url)
            if dl_resp.status_code != 200:
                os.unlink(filepath)
                return ImageResult(
                    label="", path="", prompt=prompt, status="failed",
                    error=f"Download failed: HTTP {dl_resp.status_code}",
                )

            with open(filepath, "wb") as f:
                f.write(dl_resp.content)

            usage = data.get("usage", {})
            return ImageResult(
                label="", path=filepath, prompt=prompt, status="done",
                url=image_url,
                metadata={
                    "model": data.get("model", self.model_id),
                    "size": images_data[0].get("size", ""),
                    "generated_images": usage.get("generated_images", 1),
                    "output_tokens": usage.get("output_tokens", 0),
                },
            )

    @staticmethod
    def _to_data_url(path: str) -> str | None:
        """Convert local file path to base64 data URL. Returns input unchanged if already a URL."""
        if not path:
            return None
        if path.startswith("http://") or path.startswith("https://") or path.startswith("data:"):
            return path
        if not os.path.isfile(path):
            return None
        try:
            import base64
            ext = os.path.splitext(path)[1].lower().lstrip(".")
            mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp"}.get(ext, "png")
            with open(path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            return f"data:image/{mime};base64,{b64}"
        except Exception:
            return None

    def _aspect_to_size(self, aspect_ratio: str) -> str:
        """Map aspect ratio to Seedream size string."""
        # Seedream supports: 2K, 3K, 4K, or explicit like "2048x2048"
        mapping = {
            "1:1":   "2048x2048",
            "4:3":   "2304x1728",
            "3:4":   "1728x2304",
            "16:9":  "2560x1440",
            "9:16":  "1440x2560",
            "21:9":  "2560x1080",
        }
        if aspect_ratio in mapping:
            return mapping[aspect_ratio]
        # If already a size like "2K", return as-is
        return aspect_ratio


# ---- StepFun (阶跃星辰) ----

class StepFunProvider(ImageProvider):
    """StepFun (阶跃星辰) image generation via OpenAI-compatible API.

    Endpoint: POST https://api.stepfun.com/v1/images/generations
    Docs: https://platform.stepfun.com/docs/zh/api-reference/images/image

    Models:
      - step-image-edit-2 (recommended) — 6B, 1-2s fast, supports text_mode
      - step-2x-large — high quality, good text rendering
      - step-1x-medium — lightweight / faster

    Notes:
      - Prompt limited to 512 chars; longer prompts are silently truncated.
      - For step-image-edit-2, size format is "height x width" (not width x height).
      - RPM limit: 10. Internal rate limiter ensures ~6s between requests.
    """

    endpoint: str = "https://api.stepfun.com/v1/images/generations"
    default_model: str = "step-image-edit-2"

    # Global rate limiter: 1 request per 6s (10 RPM ceiling)
    _rate_limit: asyncio.Semaphore = asyncio.Semaphore(1)
    _last_request: float = 0

    # Size mapping for step-image-edit-2 (format: "height x width")
    _SIZE_MAP: dict[str, str] = {
        "1:1":  "1024x1024",
        "4:3":  "896x1184",    # landscape 4:3
        "3:4":  "1184x896",    # portrait 3:4
        "16:9": "768x1360",    # landscape 16:9
        "9:16": "1360x768",    # portrait 9:16
    }

    def __init__(self):
        self._api_key = config.STEPFUN_API_KEY
        self._model = config.STEPFUN_MODEL
        self._headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._api_key}",
        }

    @property
    def name(self) -> str:
        return f"StepFun ({self._model})"

    async def generate(
        self,
        prompt: str,
        aspect_ratio: str = "4:3",
        **kwargs: Any,
    ) -> ImageResult:
        # Rate limit: ensure ~6s gap between requests (10 RPM ceiling)
        async with self._rate_limit:
            import time as _time
            elapsed = _time.monotonic() - self._last_request
            if elapsed < 6.0:
                await asyncio.sleep(6.0 - elapsed)
            self._last_request = _time.monotonic()

        truncated = prompt[:512]  # hard API limit
        size = self._SIZE_MAP.get(aspect_ratio, "1024x1024")

        body: dict[str, Any] = {
            "model": self._model,
            "prompt": truncated,
            "size": size,
            "response_format": "url",
        }

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(self.endpoint, headers=self._headers, json=body)

            if resp.status_code != 200:
                return ImageResult(
                    label="", path="", prompt=prompt, status="failed",
                    error=f"HTTP {resp.status_code}: {resp.text[:500]}",
                )

            data = resp.json()
            images_data = data.get("data", [])
            if not images_data:
                return ImageResult(
                    label="", path="", prompt=prompt, status="failed",
                    error=f"No image data in response: {data}",
                )

            image_obj = images_data[0]
            finish_reason = image_obj.get("finish_reason", "")
            if finish_reason == "content_filtered":
                return ImageResult(
                    label="", path="", prompt=prompt, status="failed",
                    error="Content filtered by StepFun moderation",
                )

            image_url = image_obj.get("url", "")
            if not image_url:
                return ImageResult(
                    label="", path="", prompt=prompt, status="failed",
                    error="No URL in response data",
                )

            # Download the image
            import hashlib
            import tempfile

            name_hash = hashlib.md5(prompt.encode()).hexdigest()[:12]
            fd, filepath = tempfile.mkstemp(
                suffix=".jpg", prefix=f"stepfun_{name_hash}_",
            )
            os.close(fd)

            dl_resp = await client.get(image_url)
            if dl_resp.status_code != 200:
                os.unlink(filepath)
                return ImageResult(
                    label="", path="", prompt=prompt, status="failed",
                    error=f"Download failed: HTTP {dl_resp.status_code}",
                )

            with open(filepath, "wb") as f:
                f.write(dl_resp.content)

            return ImageResult(
                label="", path=filepath, prompt=prompt, status="done",
                url=image_url,
                metadata={
                    "model": self._model,
                    "size": size,
                    "seed": image_obj.get("seed"),
                },
            )


# ---- ComfyUI (local) ----

class ComfyUIProvider(ImageProvider):
    """Local ComfyUI server — full control, no API cost, but requires GPU."""

    def __init__(self, workflow_template: dict | None = None):
        self._url = config.COMFYUI_URL.rstrip("/")
        self._workflow = workflow_template or {}
        self._out_dir = str(ensure_output_dir())

    @property
    def name(self) -> str:
        return f"ComfyUI ({self._url})"

    async def generate(self, prompt: str, aspect_ratio: str = "4:3") -> ImageResult:
        workflow = self._build_workflow(prompt, aspect_ratio)
        async with httpx.AsyncClient(timeout=600) as client:
            resp = await client.post(f"{self._url}/prompt", json={"prompt": workflow})
            resp.raise_for_status()
            prompt_id = resp.json()["prompt_id"]

            # Poll for output
            while True:
                await asyncio.sleep(2)
                hist = await client.get(f"{self._url}/history/{prompt_id}")
                hist.raise_for_status()
                data = hist.json()
                if prompt_id in data:
                    outputs = data[prompt_id]["outputs"]
                    # Find first image output
                    for node_id, node_output in outputs.items():
                        images = node_output.get("images", [])
                        if images:
                            img_info = images[0]
                            src = os.path.join(self._url, "view", img_info["filename"])
                            filepath = os.path.join(self._out_dir, img_info["filename"])
                            dl = await client.get(f"{self._url}/view", params={"filename": img_info["filename"]})
                            dl.raise_for_status()
                            with open(filepath, "wb") as f:
                                f.write(dl.content)
                            return ImageResult(
                                label="", path=filepath, prompt=prompt,
                                status="done", url=src,
                                metadata={"workflow": "comfyui", "node": node_id},
                            )
                    return ImageResult(
                        label="", path="", prompt=prompt,
                        status="failed", error="no image output found in workflow",
                    )

    def _build_workflow(self, prompt: str, aspect_ratio: str) -> dict:
        """Override with actual ComfyUI workflow JSON."""
        # Placeholder — real workflow depends on your ComfyUI setup
        return {
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            **self._workflow,
        }


# ---- Null / Placeholder ----

class NullImageProvider(ImageProvider):
    """Fallback: saves prompt to file, does not generate. For testing."""

    @property
    def name(self) -> str:
        return "Null (prompts only)"

    async def generate(self, prompt: str, aspect_ratio: str = "4:3") -> ImageResult:
        import hashlib
        name_hash = hashlib.md5(prompt.encode()).hexdigest()[:12]
        filepath = os.path.join(str(ensure_output_dir()), f"{name_hash}_prompt.txt")
        with open(filepath, "w") as f:
            f.write(prompt)
        return ImageResult(
            label="", path=filepath, prompt=prompt, status="pending",
            metadata={"note": "Prompt saved. Generate manually or configure an image provider."},
        )


# ============================================================================
# Provider Factory
# ============================================================================

_PROVIDER_REGISTRY: dict[str, type[ImageProvider]] = {
    "flux":         Flux11ProProvider,
    "flux-ultra":   Flux11ProUltraProvider,
    "sdxl":         SDXLProvider,
    "seedream":     SeedreamProvider,
    "stepfun":      StepFunProvider,
    "comfyui":      ComfyUIProvider,
    "null":         NullImageProvider,
}


def create_image_provider(provider_name: str | None = None) -> ImageProvider:
    """Create an image provider from config or explicit name.

    Set IMAGE_PROVIDER in .env to one of: flux, flux-ultra, sdxl, seedream, stepfun, comfyui, null
    """
    name = provider_name or config.IMAGE_PROVIDER
    cls = _PROVIDER_REGISTRY.get(name)
    if cls is None:
        raise ValueError(
            f"Unknown image provider '{name}'. Available: {list(_PROVIDER_REGISTRY.keys())}"
        )
    instance = cls()
    return instance


def list_providers() -> list[str]:
    """Return list of available provider names."""
    return list(_PROVIDER_REGISTRY.keys())


# ============================================================================
# Pipeline: uses an ImageProvider to generate all assets
# ============================================================================

class Step2Pipeline:
    """Orchestrates character + scene asset generation using any ImageProvider."""

    def __init__(self, provider: ImageProvider | None = None):
        self.provider = provider or create_image_provider()
        self.out_dir = ensure_output_dir()

    async def generate_all(self, storyboard: dict) -> dict:
        """Generate all visual assets from storyboard."""
        logger.info("Image provider: %s", self.provider.name)

        characters = storyboard.get("characters", [])
        scenes = storyboard.get("scenes", [])

        chars_dir = str(ensure_output_dir("characters"))
        scenes_dir_str = str(ensure_output_dir("scenes"))
        ensure_output_dir("shots")  # ensure shots root exists

        # ---- Characters: 3 portraits each ----
        logger.info("Generating %d characters x 3 angles...", len(characters))
        all_prompts: list[tuple[str, str, str]] = []
        for char in characters:
            ref_id = char.get("ref_id", char.get("id", "UNKNOWN"))
            name = char.get("name", ref_id)
            prompts = self._build_character_prompts(char)
            for label_suffix, prompt in prompts:
                all_prompts.append((prompt, f"{ref_id}_{label_suffix}", "3:4"))

        char_results = await self.provider.generate_batch(all_prompts)
        char_map: dict[str, list[ImageResult]] = {}
        for i, r in enumerate(char_results):
            ref_id = all_prompts[i][1].rsplit("_", 1)[0]
            suffix = all_prompts[i][1].rsplit("_", 1)[1]
            if r.status == "done" and r.path:
                import shutil
                ext = os.path.splitext(r.path)[1]
                target = os.path.join(chars_dir, f"{ref_id}_{suffix}{ext}")
                shutil.move(r.path, target)
                r.path = target
            char_map.setdefault(ref_id, []).append(r)
        for name, results in char_map.items():
            done = sum(1 for r in results if r.status == "done")
            logger.info("  %s: %d/%d done", name, done, len(results))

        # ---- Scenes: 1-2 images each ----
        logger.info("Generating %d scenes...", len(scenes))
        scene_prompts: list[tuple[str, str, str]] = []
        for scene in scenes:
            sid = scene.get("scene_id", scene.get("id", "UNKNOWN"))
            prompts = self._build_scene_prompts(scene)
            for label_suffix, prompt in prompts:
                scene_prompts.append((prompt, f"{sid}_{label_suffix}", "16:9"))

        scene_results = await self.provider.generate_batch(scene_prompts)
        scene_map: dict[str, list[ImageResult]] = {}
        for i, r in enumerate(scene_results):
            sid = scene_prompts[i][1].rsplit("_", 1)[0]
            suffix = scene_prompts[i][1].rsplit("_", 1)[1]
            if r.status == "done" and r.path:
                import shutil
                ext = os.path.splitext(r.path)[1]
                target = os.path.join(scenes_dir_str, f"{sid}_{suffix}{ext}")
                shutil.move(r.path, target)
                r.path = target
            scene_map.setdefault(sid, []).append(r)
        for name, results in scene_map.items():
            done = sum(1 for r in results if r.status == "done")
            logger.info("  %s: %d/%d done", name, done, len(results))

        # ---- Shots: start frame for each (with character + scene refs) ----
        shots = storyboard.get("shots", [])
        shot_map: dict[str, list[ImageResult]] = {}
        if shots:
            logger.info("Generating start frames for %d shots...", len(shots))

            async def _gen_shot_start_frame(shot: dict) -> ImageResult | None:
                shot_id = shot["full_shot_id"]
                logger.info("  %s: start frame generation...", shot_id)

                # Read start frame prompt from dedicated .md file
                sf_md_path = ensure_output_dir("shots", shot_id) / f"{shot_id}_startframe.md"
                if sf_md_path.is_file():
                    sf_prompt = sf_md_path.read_text(encoding="utf-8").strip()
                else:
                    sf_prompt = shot.get("start_frame_prompt", "")
                if not sf_prompt:
                    return None

                # Read deps.json to find character/scene dependencies
                deps = load_json(str(ensure_output_dir("shots", shot_id) / "deps.json"))
                char_ref_ids = deps.get("character_refs", [])
                scene_ref_id = deps.get("scene_id", "")

                # Collect reference images for this shot
                ref_paths: list[str] = []
                # Character portraits (1 per character in shot)
                for ref_id in char_ref_ids:
                    if ref_id in char_map:
                        for r in char_map[ref_id]:
                            if r.status == "done" and os.path.isfile(r.path):
                                ref_paths.append(r.path)
                                break
                # Scene reference
                if scene_ref_id in scene_map:
                    for r in scene_map[scene_ref_id]:
                        if r.status == "done" and os.path.isfile(r.path):
                            ref_paths.append(r.path)
                            break

                r = None
                for attempt in range(3):
                    r = await self.provider.generate(sf_prompt, "16:9", reference_images=ref_paths or None)
                    if r.status == "done":
                        break
                    logger.warning("  %s start frame attempt %d failed: %s", shot_id, attempt + 1, r.error or "unknown")
                    await asyncio.sleep(2 ** attempt)
                if r is None or r.status != "done":
                    logger.warning("  %s: all start frame attempts failed", shot_id)
                    return None
                r.label = shot_id
                logger.info("  %s: start frame done", shot_id)

            results: list[ImageResult | None] = []
            for s in shots:
                r = await _gen_shot_start_frame(s)
                results.append(r)
            for r in results:
                if r is None:
                    continue
                shot_id = r.label
                if r.status == "done" and r.path:
                    import shutil
                    ext = os.path.splitext(r.path)[1]
                    shot_dir = str(ensure_output_dir("shots", shot_id))
                    target = os.path.join(shot_dir, f"{shot_id}_startframe{ext}")
                    shutil.move(r.path, target)
                    r.path = target
                shot_map.setdefault(shot_id, []).append(r)
            total = sum(1 for r in results if r is not None)
            done_count = sum(1 for results in shot_map.values() for r in results if r.status == "done")
            logger.info("  Shots: %d/%d start frames done", done_count, total)

        # Build manifest
        manifest = self._build_manifest(char_map, scene_map, shot_map, characters, scenes, shots)
        save_json(manifest, str(ensure_output_dir() / "manifest.json"))
        logger.info("Asset manifest saved: %d entries", len(manifest))
        return manifest

    # ---- Prompt builders: read from .md files (model data) ----

    def _build_character_prompts(self, char: dict) -> list[tuple[str, str]]:
        """Build prompts for a character by reading from characters/{ref_id}.md."""
        ref_id = char["ref_id"]

        prompts = self._read_character_md_prompts(ref_id)
        if prompts:
            return [
                ("front",    prompts["front"]),
                ("profile",  prompts.get("profile", prompts["front"])),
                ("fullbody", prompts.get("fullbody", prompts["front"])),
            ]

        # Fallback (shouldn't happen with proper Step 1 output)
        return [
            ("front", CHARACTER_PORTRAIT_FRONT.format(
                name=ref_id, gender="", age="",
                face_features="", hair="",
                mood="neutral", clothing_collar="",
            )),
            ("profile", CHARACTER_PORTRAIT_PROFILE.format(
                name=ref_id, gender="", age="",
                face_features="", hair="",
                clothing_upper="",
            )),
            ("fullbody", CHARACTER_FULL_BODY.format(
                name=ref_id, gender="", age="",
                face_features="", full_outfit="",
            )),
        ]

    def _build_scene_prompts(self, scene: dict) -> list[tuple[str, str]]:
        """Build prompts for a scene by reading from scenes/{sid}.md."""
        sid = scene["scene_id"]

        prompts = self._read_scene_md_prompts(sid)
        if prompts.get("wide"):
            result = [("wide", prompts["wide"])]
            if prompts.get("detail"):
                result.append(("detail", prompts["detail"]))
            return result

        # Fallback
        wide_prompt = SCENE_REFERENCE_WIDE.format(
            location_description=sid,
            time_of_day="",
            spatial_description="",
            lighting_description="",
            color_mood="",
            key_props_and_positions="",
            window_exterior="",
        )
        return [("wide", wide_prompt)]

    # ---- .md prompt extractors ----

    @staticmethod
    def _read_character_md_prompts(ref_id: str) -> dict[str, str]:
        """Extract portrait prompts from characters/{ref_id}.md."""
        import re
        md_path = ensure_output_dir("characters") / f"{ref_id}.md"
        if not md_path.is_file():
            return {}
        text = md_path.read_text(encoding="utf-8")
        result: dict[str, str] = {}
        patterns = [
            ("front",    r"##\s*定妆照\s*Prompt\s*[—\-—]\s*正面胸像\s*\n```\n(.+?)\n```"),
            ("profile",  r"##\s*定妆照\s*Prompt\s*[—\-—]\s*45°侧面\s*\n```\n(.+?)\n```"),
            ("fullbody", r"##\s*定妆照\s*Prompt\s*[—\-—]\s*全身\s*\n```\n(.+?)\n```"),
        ]
        for key, pat in patterns:
            m = re.search(pat, text, re.DOTALL)
            if m:
                result[key] = m.group(1).strip()
        return result

    @staticmethod
    def _read_entity_name(subdir: str, entity_id: str) -> str:
        """Read entity name from .md first line: '# {id} | {name}'."""
        md_path = ensure_output_dir(subdir) / f"{entity_id}.md"
        if not md_path.is_file():
            return entity_id
        first_line = md_path.read_text(encoding="utf-8").split("\n")[0]
        # Format: "# SC_01 | 雨夜公寓" or "# ANNA | 安娜"
        parts = first_line.split("|", 1)
        return parts[1].strip() if len(parts) > 1 else entity_id

    @staticmethod
    def _parse_shot_id(shot_id: str) -> tuple[str, int]:
        """Parse 'SC01_SHOT02' -> ('SC01', 2)."""
        import re
        m = re.match(r"(.+)_SHOT(\d+)", shot_id)
        if m:
            return m.group(1), int(m.group(2))
        return shot_id, 0

    @staticmethod
    def _read_scene_md_prompts(sid: str) -> dict[str, str]:
        """Extract scene reference prompts from scenes/{sid}.md."""
        import re
        md_path = ensure_output_dir("scenes") / f"{sid}.md"
        if not md_path.is_file():
            return {}
        text = md_path.read_text(encoding="utf-8")
        result: dict[str, str] = {}
        patterns = [
            ("wide",   r"##\s*场景参考图\s*Prompt\s*[—\-—]\s*广角\s*\n```\n(.+?)\n```"),
            ("detail", r"##\s*场景参考图\s*Prompt\s*[—\-—]\s*细节特写\s*\n```\n(.+?)\n```"),
        ]
        for key, pat in patterns:
            m = re.search(pat, text, re.DOTALL)
            if m:
                result[key] = m.group(1).strip()
        return result

    def _build_manifest(
        self,
        char_map: dict[str, list[ImageResult]],
        scene_map: dict[str, list[ImageResult]],
        shot_map: dict[str, list[ImageResult]],
        characters: list[dict],
        scenes: list[dict],
        shots: list[dict],
    ) -> dict:
        """Build flat asset manifest for downstream consumption."""
        manifest: dict[str, dict[str, Any]] = {}

        # Names come from .md first line: "# {id} | {name}"
        char_names = {c["ref_id"]: self._read_entity_name("characters", c["ref_id"]) for c in characters}
        for ref_id, results in char_map.items():
            for r in results:
                manifest[r.label] = {
                    "file": r.path,
                    "type": "character",
                    "character_id": ref_id,
                    "character_name": char_names.get(ref_id, ref_id),
                    "prompt": r.prompt,
                    "status": r.status,
                    **({"error": r.error} if r.error else {}),
                }

        scene_names = {s["scene_id"]: self._read_entity_name("scenes", s["scene_id"]) for s in scenes}
        for sid, results in scene_map.items():
            for r in results:
                manifest[r.label] = {
                    "file": r.path,
                    "type": "scene",
                    "scene_id": sid,
                    "scene_name": scene_names.get(sid, sid),
                    "prompt": r.prompt,
                    "status": r.status,
                    **({"error": r.error} if r.error else {}),
                }

        for shot_id, results in shot_map.items():
            scene_id, shot_num = self._parse_shot_id(shot_id)
            for r in results:
                manifest[r.label] = {
                    "file": r.path,
                    "type": "shot_start_frame",
                    "shot_id": shot_id,
                    "scene_id": scene_id,
                    "shot_num": shot_num,
                    "prompt": r.prompt,
                    "status": r.status,
                    **({"error": r.error} if r.error else {}),
                }

        return manifest


# ============================================================================
# Convenience
# ============================================================================

async def generate_assets(storyboard_path: str, provider_name: str | None = None) -> dict:
    """Convenience: storyboard JSON -> asset manifest."""
    storyboard = load_json(storyboard_path)
    provider = create_image_provider(provider_name)
    pipeline = Step2Pipeline(provider)
    return await pipeline.generate_all(storyboard)
