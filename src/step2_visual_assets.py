"""
Step 2: Visual asset generation.

Generates character portraits (3 angles) and scene reference images.

Architecture: Provider abstraction → easy swap between image models.
"""

from __future__ import annotations

import asyncio
import glob
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

import httpx

from config import config
from src.prompts import get_image_template
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
    """Orchestrates character, scene, and prop asset generation using any ImageProvider."""

    def __init__(self, provider: ImageProvider | None = None):
        self.provider = provider or create_image_provider()
        self.out_dir = ensure_output_dir()

    async def generate_all(self, storyboard: dict) -> dict:
        """Generate all visual assets from storyboard."""
        logger.info("Image provider: %s", self.provider.name)

        characters = storyboard.get("characters", [])
        scenes = storyboard.get("scenes", [])
        props = storyboard.get("props", [])

        chars_dir = str(ensure_output_dir("characters"))
        scenes_dir_str = str(ensure_output_dir("scenes"))
        props_dir_str = str(ensure_output_dir("props"))
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

        # ---- Props: one isolated reference image each ----
        logger.info("Generating %d prop reference images...", len(props))
        prop_prompts: list[tuple[str, str, str]] = []
        for prop in props:
            ref_id = prop.get("ref_id", prop.get("id", "UNKNOWN"))
            for label_suffix, prompt in self._build_prop_prompts(prop):
                prop_prompts.append((prompt, f"{ref_id}_{label_suffix}", "1:1"))

        prop_results = await self.provider.generate_batch(prop_prompts)
        prop_map: dict[str, list[ImageResult]] = {}
        for i, r in enumerate(prop_results):
            ref_id = prop_prompts[i][1].rsplit("_", 1)[0]
            suffix = prop_prompts[i][1].rsplit("_", 1)[1]
            if r.status == "done" and r.path:
                import shutil
                ext = os.path.splitext(r.path)[1]
                target = os.path.join(props_dir_str, f"{ref_id}_{suffix}{ext}")
                shutil.move(r.path, target)
                r.path = target
            prop_map.setdefault(ref_id, []).append(r)
        for name, results in prop_map.items():
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
                    # Fallback: read the main shot .md for scene description
                    main_md_path = ensure_output_dir("shots", shot_id) / f"{shot_id}.md"
                    if main_md_path.is_file():
                        main_text = main_md_path.read_text(encoding="utf-8").strip()
                        import re
                        sections = []
                        for section_name in ["画面内容", "构图与空间", "光影", "色彩"]:
                            m = re.search(rf"##\s*{section_name}\s*\n(.+?)(?=\n##|$)", main_text, re.DOTALL)
                            if m:
                                sections.append(m.group(1).strip().replace("\n", " "))
                        if sections:
                            sf_prompt = " | ".join(sections)
                if not sf_prompt:
                    return None

                # Read deps.json to find character/scene dependencies
                deps = load_json(str(ensure_output_dir("shots", shot_id) / "deps.json"))
                char_ref_ids = deps.get("character_refs", [])
                scene_ref_id = deps.get("scene_id", "")
                prop_ref_ids = deps.get("prop_refs", [])

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
                # Key prop reference images (only props used in this shot)
                for ref_id in prop_ref_ids:
                    if ref_id in prop_map:
                        for r in prop_map[ref_id]:
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
                return r

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

            # Update storyboard.json with actual startframe file paths (fix extension mismatch)
            storyboard_path = ensure_output_dir() / "storyboard.json"
            if storyboard_path.is_file():
                storyboard = load_json(str(storyboard_path))
                for shot in storyboard.get("shots", []):
                    sid = shot.get("full_shot_id", "")
                    if sid in shot_map:
                        for r in shot_map[sid]:
                            if r.status == "done" and r.path:
                                shot["startframe_file"] = os.path.relpath(r.path, str(ensure_output_dir()))
                                break
                save_json(storyboard, str(storyboard_path))

        # Build manifest
        manifest = self._build_manifest(char_map, scene_map, prop_map, shot_map, characters, scenes, props, shots)
        save_json(manifest, str(ensure_output_dir() / "manifest.json"))
        logger.info("Asset manifest saved: %d entries", len(manifest))
        return manifest

    # ---- Regeneration: single-item granularity ----

    async def regenerate_characters(self, storyboard: dict, ref_ids: list[str]) -> None:
        """Regenerate specific characters' 3-angle portraits, replacing old files."""
        logger.info("Regenerating characters: %s", ref_ids)
        chars_dir = str(ensure_output_dir("characters"))
        characters = storyboard.get("characters", [])
        manifest_path = ensure_output_dir() / "manifest.json"
        manifest = load_json(str(manifest_path)) if manifest_path.is_file() else {}

        for char in characters:
            ref_id = char.get("ref_id", char.get("id", ""))
            if ref_id not in ref_ids:
                continue

            prompts = self._build_character_prompts(char)
            all_prompts: list[tuple[str, str, str]] = []
            for label_suffix, prompt in prompts:
                all_prompts.append((prompt, f"{ref_id}_{label_suffix}", "3:4"))

            results = await self.provider.generate_batch(all_prompts)
            for i, r in enumerate(results):
                suffix = all_prompts[i][1].rsplit("_", 1)[1]
                if r.status == "done" and r.path:
                    import shutil
                    ext = os.path.splitext(r.path)[1]
                    target = os.path.join(chars_dir, f"{ref_id}_{suffix}{ext}")
                    # Remove old file if exists
                    old_glob = glob.glob(os.path.join(chars_dir, f"{ref_id}_{suffix}.*"))
                    for old in old_glob:
                        os.remove(old)
                    shutil.move(r.path, target)
                    r.path = target
                    logger.info("  %s_%s: regenerated -> %s", ref_id, suffix, target)
                    # Update manifest
                    manifest_key = f"{ref_id}_{suffix}"
                    name = self._read_entity_name("characters", ref_id)
                    manifest[manifest_key] = {
                        "file": target,
                        "type": "character",
                        "character_id": ref_id,
                        "character_name": name or ref_id,
                        "prompt": r.prompt,
                        "status": "done",
                    }
                else:
                    logger.warning("  %s_%s: regeneration failed: %s", ref_id, suffix, r.error or "unknown")

        save_json(manifest, str(manifest_path))
        logger.info("Manifest updated after character regeneration")

    async def regenerate_single_character_images(self, storyboard: dict, labels: list[str]) -> None:
        """Regenerate specific character images by label (e.g. char1_front), one at a time."""
        logger.info("Regenerating single character images: %s", labels)
        chars_dir = str(ensure_output_dir("characters"))
        characters = storyboard.get("characters", [])
        manifest_path = ensure_output_dir() / "manifest.json"
        manifest = load_json(str(manifest_path)) if manifest_path.is_file() else {}

        # Build a lookup from storyboard characters
        char_map = {c.get("ref_id", c.get("id", "")): c for c in characters}

        for label in labels:
            # label format: ref_id_suffix (e.g. char1_front)
            *ref_parts, suffix = label.rsplit("_", 1)
            ref_id = "_".join(ref_parts)
            char = char_map.get(ref_id)
            if char is None:
                logger.warning("  %s: character not found in storyboard", ref_id)
                continue

            prompts = self._build_character_prompts(char)
            prompt_for_suffix = dict(prompts).get(suffix)
            if not prompt_for_suffix:
                logger.warning("  %s: suffix '%s' not found in character prompts", label, suffix)
                continue

            logger.info("  %s: regenerating...", label)
            r = await self.provider.generate(prompt_for_suffix, "3:4")
            if r.status == "done" and r.path:
                import shutil
                ext = os.path.splitext(r.path)[1]
                target = os.path.join(chars_dir, f"{label}{ext}")
                old_glob = glob.glob(os.path.join(chars_dir, f"{label}.*"))
                for old in old_glob:
                    os.remove(old)
                shutil.move(r.path, target)
                r.path = target
                logger.info("  %s: regenerated -> %s", label, target)
                name = self._read_entity_name("characters", ref_id)
                manifest[label] = {
                    "file": target,
                    "type": "character",
                    "character_id": ref_id,
                    "character_name": name or ref_id,
                    "prompt": r.prompt,
                    "status": "done",
                }
            else:
                logger.warning("  %s: regeneration failed: %s", label, r.error or "unknown")

        save_json(manifest, str(manifest_path))
        logger.info("Manifest updated after single character image regeneration")

    async def regenerate_scenes(self, storyboard: dict, scene_ids: list[str]) -> None:
        """Regenerate specific scene reference images, replacing old files."""
        logger.info("Regenerating scenes: %s", scene_ids)
        scenes_dir = str(ensure_output_dir("scenes"))
        scenes = storyboard.get("scenes", [])
        manifest_path = ensure_output_dir() / "manifest.json"
        manifest = load_json(str(manifest_path)) if manifest_path.is_file() else {}

        for scene in scenes:
            sid = scene.get("scene_id", scene.get("id", ""))
            if sid not in scene_ids:
                continue

            prompts = self._build_scene_prompts(scene)
            scene_prompts: list[tuple[str, str, str]] = []
            for label_suffix, prompt in prompts:
                scene_prompts.append((prompt, f"{sid}_{label_suffix}", "16:9"))

            results = await self.provider.generate_batch(scene_prompts)
            for i, r in enumerate(results):
                suffix = scene_prompts[i][1].rsplit("_", 1)[1]
                if r.status == "done" and r.path:
                    import shutil
                    ext = os.path.splitext(r.path)[1]
                    target = os.path.join(scenes_dir, f"{sid}_{suffix}{ext}")
                    old_glob = glob.glob(os.path.join(scenes_dir, f"{sid}_{suffix}.*"))
                    for old in old_glob:
                        os.remove(old)
                    shutil.move(r.path, target)
                    r.path = target
                    logger.info("  %s_%s: regenerated -> %s", sid, suffix, target)
                    manifest_key = f"{sid}_{suffix}"
                    name = self._read_entity_name("scenes", sid)
                    manifest[manifest_key] = {
                        "file": target,
                        "type": "scene",
                        "scene_id": sid,
                        "scene_name": name or sid,
                        "prompt": r.prompt,
                        "status": "done",
                    }
                else:
                    logger.warning("  %s_%s: regeneration failed: %s", sid, suffix, r.error or "unknown")

        save_json(manifest, str(manifest_path))
        logger.info("Manifest updated after scene regeneration")

    async def regenerate_single_scene_images(self, storyboard: dict, labels: list[str]) -> None:
        """Regenerate specific scene images by label (e.g. SC_01_wide), one at a time."""
        logger.info("Regenerating single scene images: %s", labels)
        scenes_dir = str(ensure_output_dir("scenes"))
        scenes = storyboard.get("scenes", [])
        manifest_path = ensure_output_dir() / "manifest.json"
        manifest = load_json(str(manifest_path)) if manifest_path.is_file() else {}

        # Build a lookup from storyboard scenes
        scene_map = {s.get("scene_id", s.get("id", "")): s for s in scenes}

        for label in labels:
            # label format: sid_suffix (e.g. SC_01_wide)
            *sid_parts, suffix = label.rsplit("_", 1)
            sid = "_".join(sid_parts)
            scene = scene_map.get(sid)
            if scene is None:
                logger.warning("  %s: scene not found in storyboard", sid)
                continue

            prompts = self._build_scene_prompts(scene)
            prompt_for_suffix = dict(prompts).get(suffix)
            if not prompt_for_suffix:
                logger.warning("  %s: suffix '%s' not found in scene prompts", label, suffix)
                continue

            logger.info("  %s: regenerating...", label)
            r = await self.provider.generate(prompt_for_suffix, "16:9")
            if r.status == "done" and r.path:
                import shutil
                ext = os.path.splitext(r.path)[1]
                target = os.path.join(scenes_dir, f"{label}{ext}")
                old_glob = glob.glob(os.path.join(scenes_dir, f"{label}.*"))
                for old in old_glob:
                    os.remove(old)
                shutil.move(r.path, target)
                r.path = target
                logger.info("  %s: regenerated -> %s", label, target)
                name = self._read_entity_name("scenes", sid)
                manifest[label] = {
                    "file": target,
                    "type": "scene",
                    "scene_id": sid,
                    "scene_name": name or sid,
                    "prompt": r.prompt,
                    "status": "done",
                }
            else:
                logger.warning("  %s: regeneration failed: %s", label, r.error or "unknown")

        save_json(manifest, str(manifest_path))
        logger.info("Manifest updated after single scene image regeneration")

    async def regenerate_shots(self, storyboard: dict, shot_ids: list[str]) -> None:
        """Regenerate specific shot start frames, replacing old files."""
        logger.info("Regenerating shots: %s", shot_ids)
        shots = storyboard.get("shots", [])
        manifest_path = ensure_output_dir() / "manifest.json"
        manifest = load_json(str(manifest_path)) if manifest_path.is_file() else {}

        # Load existing character, scene, and prop maps for reference images
        char_map: dict[str, list[ImageResult]] = {}
        scene_map: dict[str, list[ImageResult]] = {}
        prop_map: dict[str, list[ImageResult]] = {}
        for key, entry in manifest.items():
            if entry.get("type") == "character":
                ref_id = entry["character_id"]
                r = ImageResult(label=key, path=entry["file"], prompt=entry.get("prompt", ""), status="done")
                char_map.setdefault(ref_id, []).append(r)
            elif entry.get("type") == "scene":
                sid = entry["scene_id"]
                r = ImageResult(label=key, path=entry["file"], prompt=entry.get("prompt", ""), status="done")
                scene_map.setdefault(sid, []).append(r)
            elif entry.get("type") == "prop":
                ref_id = entry["prop_id"]
                r = ImageResult(label=key, path=entry["file"], prompt=entry.get("prompt", ""), status="done")
                prop_map.setdefault(ref_id, []).append(r)

        for shot in shots:
            shot_id = shot.get("full_shot_id", "")
            if shot_id not in shot_ids:
                continue

            logger.info("  %s: regenerating start frame...", shot_id)

            # Read start frame prompt
            sf_md_path = ensure_output_dir("shots", shot_id) / f"{shot_id}_startframe.md"
            if sf_md_path.is_file():
                sf_prompt = sf_md_path.read_text(encoding="utf-8").strip()
            else:
                sf_prompt = shot.get("start_frame_prompt", "")
            if not sf_prompt:
                # Fallback: read the main shot .md for scene description
                main_md_path = ensure_output_dir("shots", shot_id) / f"{shot_id}.md"
                if main_md_path.is_file():
                    main_text = main_md_path.read_text(encoding="utf-8").strip()
                    # Extract relevant sections for a static frame description
                    import re
                    sections = []
                    for section_name in ["画面内容", "构图与空间", "光影", "色彩"]:
                        m = re.search(rf"##\s*{section_name}\s*\n(.+?)(?=\n##|$)", main_text, re.DOTALL)
                        if m:
                            sections.append(m.group(1).strip().replace("\n", " "))
                    if sections:
                        sf_prompt = " | ".join(sections)
                        logger.info("  %s: composed start frame prompt from shot .md", shot_id)
            if not sf_prompt:
                logger.warning("  %s: no start frame prompt, skipping", shot_id)
                continue

            # Read deps for reference images
            deps = load_json(str(ensure_output_dir("shots", shot_id) / "deps.json"))
            char_ref_ids = deps.get("character_refs", [])
            scene_ref_id = deps.get("scene_id", "")
            prop_ref_ids = deps.get("prop_refs", [])

            ref_paths: list[str] = []
            for ref_id in char_ref_ids:
                if ref_id in char_map:
                    for r in char_map[ref_id]:
                        if r.status == "done" and os.path.isfile(r.path):
                            ref_paths.append(r.path)
                            break
            if scene_ref_id in scene_map:
                for r in scene_map[scene_ref_id]:
                    if r.status == "done" and os.path.isfile(r.path):
                        ref_paths.append(r.path)
                        break
            for ref_id in prop_ref_ids:
                if ref_id in prop_map:
                    for r in prop_map[ref_id]:
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
                logger.warning("  %s: all start frame regeneration attempts failed", shot_id)
                continue

            if r.path:
                import shutil
                ext = os.path.splitext(r.path)[1]
                shot_dir = str(ensure_output_dir("shots", shot_id))
                target = os.path.join(shot_dir, f"{shot_id}_startframe{ext}")
                old_glob = glob.glob(os.path.join(shot_dir, f"{shot_id}_startframe.*"))
                for old in old_glob:
                    if not old.endswith(('.md', '.txt', '.json')):
                        os.remove(old)
                shutil.move(r.path, target)
                r.path = target
                logger.info("  %s: start frame regenerated -> %s", shot_id, target)

                # Update manifest
                manifest[shot_id] = {
                    "file": target,
                    "type": "shot_start_frame",
                    "shot_id": shot_id,
                    "scene_id": deps.get("scene_id", ""),
                    "shot_num": self._parse_shot_id(shot_id)[1],
                    "prompt": sf_prompt,
                    "status": "done",
                }

                # Update storyboard.json startframe_file
                sb_path = ensure_output_dir() / "storyboard.json"
                if sb_path.is_file():
                    sb = load_json(str(sb_path))
                    for s in sb.get("shots", []):
                        if s.get("full_shot_id") == shot_id:
                            s["startframe_file"] = os.path.relpath(target, str(ensure_output_dir()))
                            break
                    save_json(sb, str(sb_path))

        save_json(manifest, str(manifest_path))
        logger.info("Manifest updated after shot regeneration")

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
        front_tpl = get_image_template("portrait_front")
        profile_tpl = get_image_template("portrait_profile")
        fullbody_tpl = get_image_template("fullbody")
        return [
            ("front", front_tpl.format(
                name=ref_id, gender="", age="",
                face_features="", hair="",
                mood="neutral", clothing_collar="",
            )),
            ("profile", profile_tpl.format(
                name=ref_id, gender="", age="",
                face_features="", hair="",
                clothing_upper="",
            )),
            ("fullbody", fullbody_tpl.format(
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
        wide_tpl = get_image_template("scene_wide")
        wide_prompt = wide_tpl.format(
            location_description=sid,
            time_of_day="",
            spatial_description="",
            lighting_description="",
            color_mood="",
            key_props_and_positions="",
            window_exterior="",
        )
        return [("wide", wide_prompt)]

    def _build_prop_prompts(self, prop: dict) -> list[tuple[str, str]]:
        """Build the isolated reference image prompt for a key prop."""
        ref_id = prop["ref_id"]
        prompt = self._read_prop_md_prompt(ref_id)
        if not prompt:
            name = prop.get("name", ref_id)
            prompt = (
                f"{name}, isolated product reference image, no people, "
                "clear full object, realistic materials, studio lighting, "
                "clean neutral background, photorealistic, 8K, 1:1 aspect ratio"
            )
        return [("reference", prompt)]

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

    @staticmethod
    def _read_prop_md_prompt(ref_id: str) -> str:
        """Extract the reference-image prompt from props/{ref_id}.md."""
        import re
        md_path = ensure_output_dir("props") / f"{ref_id}.md"
        if not md_path.is_file():
            return ""
        text = md_path.read_text(encoding="utf-8")
        match = re.search(r"##\s*道具参考图\s*Prompt\s*\n```\n(.+?)\n```", text, re.DOTALL)
        return match.group(1).strip() if match else ""

    def _build_manifest(
        self,
        char_map: dict[str, list[ImageResult]],
        scene_map: dict[str, list[ImageResult]],
        prop_map: dict[str, list[ImageResult]],
        shot_map: dict[str, list[ImageResult]],
        characters: list[dict],
        scenes: list[dict],
        props: list[dict],
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

        prop_names = {p["ref_id"]: self._read_entity_name("props", p["ref_id"]) for p in props}
        for ref_id, results in prop_map.items():
            for r in results:
                manifest[r.label] = {
                    "file": r.path,
                    "type": "prop",
                    "prop_id": ref_id,
                    "prop_name": prop_names.get(ref_id, ref_id),
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


async def regenerate_assets(
    storyboard_path: str,
    char_ids: list[str] | None = None,
    char_image_labels: list[str] | None = None,
    scene_ids: list[str] | None = None,
    scene_image_labels: list[str] | None = None,
    shot_ids: list[str] | None = None,
    provider_name: str | None = None,
) -> dict:
    """Regenerate specific assets from storyboard, preserving existing ones.

    Args:
        storyboard_path: Path to storyboard.json
        char_ids: List of character ref_ids to regenerate (all 3 angles)
        char_image_labels: List of specific character image labels (e.g. char1_front)
        scene_ids: List of scene_ids to regenerate (all images)
        scene_image_labels: List of specific scene image labels (e.g. SC_01_wide)
        shot_ids: List of shot_ids to regenerate
        provider_name: Optional provider override

    Returns:
        Updated manifest dict
    """
    storyboard = load_json(storyboard_path)
    provider = create_image_provider(provider_name)
    pipeline = Step2Pipeline(provider)

    if char_ids:
        await pipeline.regenerate_characters(storyboard, char_ids)
    if char_image_labels:
        await pipeline.regenerate_single_character_images(storyboard, char_image_labels)
    if scene_ids:
        await pipeline.regenerate_scenes(storyboard, scene_ids)
    if scene_image_labels:
        await pipeline.regenerate_single_scene_images(storyboard, scene_image_labels)
    if shot_ids:
        await pipeline.regenerate_shots(storyboard, shot_ids)

    # Reload and return the updated manifest
    manifest_path = ensure_output_dir() / "manifest.json"
    return load_json(str(manifest_path))
