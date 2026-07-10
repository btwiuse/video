"""
Step 4: Audio pipeline.

Layers:
  1. Dialogue  - TTS via pluggable AudioProvider (default: null / off)
  2. Ambience  - AI-generated ambient soundscapes, looped per scene
  3. SFX       - Sound effects matched from foley library / AI generation
  4. BGM       - Background music via Suno/Udio, volume-enveloped

Output: individual audio files and a mixing manifest for Step 5.
"""

from __future__ import annotations

import asyncio
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("step4")

import httpx

from config import config
from src.prompts import (
    AMBIENCE_GENERATION_PROMPT,
    SFX_GENERATION_PROMPT,
    BGM_GENERATION_PROMPT,
)
from src.utils import ensure_output_dir, save_json, load_json, format_timestamp


# ============================================================================
# Result type
# ============================================================================

@dataclass
class AudioResult:
    """Result of a single audio generation."""
    label: str
    path: str
    status: str = "pending"       # "done" | "failed" | "pending"
    error: str = ""


# ============================================================================
# Abstract TTS Provider
# ============================================================================

class TTSProvider(ABC):
    """Abstract interface for text-to-speech backends.

    To add a new TTS model, subclass this and implement generate_speech().
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider name, e.g. 'ElevenLabs'."""

    @abstractmethod
    async def generate_speech(
        self,
        text: str,
        character: str,
        emotion: str | None,
        output_path: str,
    ) -> AudioResult:
        """Generate speech audio for one dialogue line."""


# ============================================================================
# ElevenLabs Provider
# ============================================================================

class ElevenLabsProvider(TTSProvider):
    """TTS via ElevenLabs multilingual v2."""

    BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech"

    def __init__(self):
        self._api_key = config.AUDIO_API_KEY

    @property
    def name(self) -> str:
        return "ElevenLabs"

    async def generate_speech(
        self,
        text: str,
        character: str,
        emotion: str | None,
        output_path: str,
    ) -> AudioResult:
        if not self._api_key:
            return AudioResult(
                label=character, path=output_path, status="pending",
                error="AUDIO_API_KEY not configured.",
            )

        voice_id = await self._get_or_create_voice(character)

        headers = {
            "xi-api-key": self._api_key,
            "Content-Type": "application/json",
        }

        body: dict[str, Any] = {
            "text": text,
            "model_id": "eleven_multilingual_v2",
        }

        # Apply emotion via voice settings
        if emotion and emotion in ("轻声", "犹豫", "whisper", "soft"):
            body["voice_settings"] = {"stability": 0.5, "similarity_boost": 0.7, "style": 0.2}
        elif emotion and emotion in ("怒吼", "激动", "angry", "shout"):
            body["voice_settings"] = {"stability": 0.3, "similarity_boost": 0.8, "style": 0.6}

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{self.BASE_URL}/{voice_id}",
                headers=headers,
                json=body,
            )
            if resp.status_code == 200:
                with open(output_path, "wb") as f:
                    f.write(resp.content)
                return AudioResult(
                    label=character, path=output_path, status="done",
                )
            return AudioResult(
                label=character, path=output_path, status="failed",
                error=resp.text[:500],
            )

    async def _get_or_create_voice(self, character: str) -> str:
        """Get or create ElevenLabs voice for a character."""
        # Voices would be pre-created via ElevenLabs API in production.
        return "21m00Tcm4TlvDq8ikWAM"  # "Rachel" fallback


# ============================================================================
# Null Provider (default — TTS off)
# ============================================================================

class NullTTSProvider(TTSProvider):
    """Default: TTS is off. Skips dialogue generation."""

    @property
    def name(self) -> str:
        return "Null (TTS off)"

    async def generate_speech(
        self,
        text: str,
        character: str,
        emotion: str | None,
        output_path: str,
    ) -> AudioResult:
        return AudioResult(
            label=character, path=output_path, status="pending",
            error="AUDIO_PROVIDER=null. Set to 'elevenlabs' to enable speech synthesis.",
        )


# ============================================================================
# Provider Factory
# ============================================================================

_TTS_REGISTRY: dict[str, type[TTSProvider]] = {
    "elevenlabs": ElevenLabsProvider,
    "null": NullTTSProvider,
}


def create_tts_provider(provider_name: str | None = None) -> TTSProvider:
    """Create a TTS provider from config or explicit name.

    Set AUDIO_PROVIDER in .env to one of: elevenlabs, null
    """
    name = provider_name or config.AUDIO_PROVIDER
    cls = _TTS_REGISTRY.get(name)
    if cls is None:
        raise ValueError(
            f"Unknown TTS provider '{name}'. Available: {list(_TTS_REGISTRY.keys())}"
        )
    return cls()


# ============================================================================
# Audio Pipeline
# ============================================================================

class AudioPipeline:
    """Generate all audio layers for the film."""

    def __init__(self, tts_provider: TTSProvider | None = None):
        self.out_dir = ensure_output_dir()
        self.dialogue_dir = ensure_output_dir("audio", "dialogue")
        self.ambience_dir = ensure_output_dir("audio", "ambience")
        self.sfx_dir = ensure_output_dir("audio", "sfx")
        self.bgm_dir = ensure_output_dir("audio", "bgm")
        self.tts = tts_provider or create_tts_provider()

    async def generate_all(self, storyboard: dict, clip_manifest: list[dict]) -> dict:
        """Generate complete audio for the film."""
        audio_manifest: dict[str, Any] = {
            "dialogue": [],
            "ambience": [],
            "sfx": [],
            "bgm": [],
        }

        # 1. Dialogue (TTS per line)
        logger.info("TTS provider: %s", self.tts.name)
        logger.info("Generating dialogue...")
        audio_manifest["dialogue"] = await self._generate_dialogue(storyboard)

        # 2. Ambience (per scene)
        logger.info("Generating ambience...")
        audio_manifest["ambience"] = await self._generate_ambience(storyboard, clip_manifest)

        # 3. SFX (per shot sfx mark)
        logger.info("Generating sound effects...")
        audio_manifest["sfx"] = await self._generate_sfx(storyboard, clip_manifest)

        # 4. BGM (per emotional arc)
        logger.info("Generating background music...")
        audio_manifest["bgm"] = await self._generate_bgm(storyboard, clip_manifest)

        save_json(audio_manifest, str(self.out_dir / "audio_manifest.json"))
        return audio_manifest

    async def _generate_dialogue(self, storyboard: dict) -> list[dict]:
        """Generate TTS for each dialogue line from shot .md files."""
        shots = storyboard.get("shots", [])
        dialogue_entries = []

        for shot in shots:
            shot_id = shot["full_shot_id"]
            audio_data = self._read_shot_md_audio(shot_id)
            dialogue = audio_data.get("dialogue")
            if not dialogue:
                continue

            parsed = self._parse_dialogue_line(dialogue)
            if not parsed:
                continue

            output_path = str(self.dialogue_dir / f"{shot_id}_dialogue.wav")

            r = await self.tts.generate_speech(
                text=parsed["text"],
                character=parsed["character"],
                emotion=parsed.get("emotion"),
                output_path=output_path,
            )

            dialogue_entries.append({
                "shot_id": shot_id,
                "character": parsed["character"],
                "text": parsed["text"],
                "emotion": parsed.get("emotion"),
                "file": output_path,
                "status": r.status,
            })

        return dialogue_entries

    # ========================================================================
    # Ambience / SFX / BGM (placeholder — not yet abstracted)
    # ========================================================================

    @staticmethod
    def _parse_dialogue_line(dialogue: str) -> dict | None:
        """Parse dialogue string into structured form."""
        import re

        # Format: 角色名 — "台词"（语气）
        match = re.match(r"(.+?)\s*[—\-]\s*\"(.+?)\"(?:\s*[（(](.+?)[）)])?", dialogue)
        if match:
            return {
                "character": match.group(1).strip(),
                "text": match.group(2).strip(),
                "emotion": match.group(3).strip() if match.group(3) else None,
            }

        # Format: 角色：台词
        match = re.match(r"(.+?)[：:]\s*(.+)", dialogue)
        if match:
            return {
                "character": match.group(1).strip(),
                "text": match.group(2).strip(),
                "emotion": None,
            }

        return None

    async def _generate_ambience(
        self, storyboard: dict, clip_manifest: list[dict]
    ) -> list[dict]:
        """Generate ambient sound for each scene from scene .md files."""
        scenes = storyboard.get("scenes", [])
        ambience_entries = []

        for scene in scenes:
            scene_id = scene["scene_id"]
            ambience_desc = self._read_scene_md_ambience(scene_id)
            if not ambience_desc:
                ambience_desc = f"ambient sound of {scene_id}"
            output_path = str(self.ambience_dir / f"{scene_id}_ambience.wav")

            duration = self._scene_duration(scene_id, clip_manifest)

            result = await self._generate_ambience_track(
                description=ambience_desc,
                duration_sec=min(duration, 120),
                output_path=output_path,
            )

            ambience_entries.append({
                "scene_id": scene_id,
                "description": ambience_desc,
                "file": output_path,
                "duration_sec": duration,
                "loop": True,
                "status": result.get("status", "pending"),
            })

        return ambience_entries

    async def _generate_ambience_track(
        self, description: str, duration_sec: float, output_path: str
    ) -> dict:
        prompt = AMBIENCE_GENERATION_PROMPT.format(scene_ambience_description=description)
        return {
            "status": "pending",
            "path": output_path,
            "prompt": prompt,
            "note": "Generate via ElevenLabs SFX API or Stable Audio with the provided prompt.",
        }

    async def _generate_sfx(
        self, storyboard: dict, clip_manifest: list[dict]
    ) -> list[dict]:
        """Generate/place sound effects from shot .md files."""
        shots = storyboard.get("shots", [])
        sfx_entries = []

        timeline = self._build_timeline_from_manifest(clip_manifest)

        for shot in shots:
            shot_id = shot["full_shot_id"]
            audio_data = self._read_shot_md_audio(shot_id)
            sfx_text = audio_data.get("sfx")
            if not sfx_text:
                continue

            sfx_items = self._parse_sfx_markers(sfx_text)
            shot_start = timeline.get(shot_id, 0)

            for item in sfx_items:
                output_path = str(self.sfx_dir / f"{item['type']}.wav")
                sfx_entries.append({
                    "shot_id": shot_id,
                    "sfx_type": item["type"],
                    "offset_sec": shot_start + item.get("offset", 0),
                    "file": output_path,
                    "status": "pending",
                    "note": f"Match '{item['type']}' from foley library or generate via SFX API.",
                })

        return sfx_entries

    # ---- .md extraction helpers ----

    @staticmethod
    def _read_shot_md_audio(shot_id: str) -> dict[str, str]:
        """Extract dialogue and sfx from shot .md audio section."""
        import re
        md_path = ensure_output_dir("shots", shot_id) / f"{shot_id}.md"
        if not md_path.is_file():
            return {}
        text = md_path.read_text(encoding="utf-8")
        result: dict[str, str] = {}

        m = re.search(r"##\s*音频\s*\n((?:- .+\n?)+)", text)
        if not m:
            return result
        section = m.group(1)

        m = re.search(r"-\s*对白[：:]\s*(.+)", section)
        if m:
            val = m.group(1).strip()
            if val and val != "（无）":
                result["dialogue"] = val

        m = re.search(r"-\s*音效[：:]\s*(.+)", section)
        if m:
            val = m.group(1).strip()
            if val and val != "（无）":
                result["sfx"] = val

        return result

    @staticmethod
    def _read_scene_md_name(scene_id: str) -> str:
        """Read scene name from .md first line: '# SC_01 | 雨夜公寓'."""
        md_path = ensure_output_dir("scenes") / f"{scene_id}.md"
        if not md_path.is_file():
            return scene_id
        first_line = md_path.read_text(encoding="utf-8").split("\n")[0]
        parts = first_line.split("|", 1)
        return parts[1].strip() if len(parts) > 1 else scene_id

    @staticmethod
    def _read_scene_md_ambience(scene_id: str) -> str:
        """Extract ambience description from scene .md."""
        import re
        md_path = ensure_output_dir("scenes") / f"{scene_id}.md"
        if not md_path.is_file():
            return ""
        text = md_path.read_text(encoding="utf-8")
        m = re.search(r"##\s*环境音\s*\n(.+?)(?:\n##|\n```|\Z)", text, re.DOTALL)
        if m:
            return m.group(1).strip()
        return ""

    def _parse_sfx_markers(self, sfx_text: str) -> list[dict]:
        """Parse SFX text into timed markers."""
        items = []
        parts = [p.strip() for p in sfx_text.replace("，", ",").split(",")]
        for part in parts:
            if not part:
                continue
            import re
            match = re.match(r"(.+?)\s+at\s+([\d.]+)s?", part)
            if match:
                items.append({"type": match.group(1).strip(), "offset": float(match.group(2))})
            else:
                items.append({"type": part, "offset": 0})
        return items

    async def _generate_bgm(
        self, storyboard: dict, clip_manifest: list[dict]
    ) -> list[dict]:
        """Generate background music per emotional segment."""
        scenes = storyboard.get("scenes", [])
        bgm_entries = []

        for scene in scenes:
            scene_id = scene["scene_id"]
            duration = self._scene_duration(scene_id, clip_manifest)
            if duration <= 0:
                continue

            output_path = str(self.bgm_dir / f"{scene_id}_bgm.wav")

            scene_name = self._read_scene_md_name(scene_id)
            scene_type = self._classify_scene_type(scene_name)

            prompt = BGM_GENERATION_PROMPT.format(
                emotion=scene_type,
                scene_type=scene_type,
                mood_description=f"underscore for {scene_name}",
                duration=int(duration),
                genre_reference="film score, ambient cinematic",
            )

            bgm_entries.append({
                "scene_id": scene_id,
                "scene_type": scene_type,
                "duration_sec": duration,
                "file": output_path,
                "prompt": prompt,
                "status": "pending",
                "note": "Generate via Suno/Udio API with the provided prompt.",
            })

        return bgm_entries

    @staticmethod
    def _classify_scene_type(scene_name: str) -> str:
        """Classify scene emotional type for BGM generation."""
        name = scene_name.lower()
        if any(kw in name for kw in ("追逐", "战斗", "动作", "chase", "fight")):
            return "action"
        if any(kw in name for kw in ("告别", "死亡", "葬礼", "哭", "分手")):
            return "sad"
        if any(kw in name for kw in ("笑", "聚会", "庆祝")):
            return "happy"
        return "neutral_dramatic"

    def _scene_duration(self, scene_id: str, clip_manifest: list[dict]) -> float:
        """Calculate total duration of a scene from clip manifest."""
        start = float("inf")
        end = 0.0
        for clip in clip_manifest:
            if clip.get("shot_id", "").startswith(scene_id):
                start = min(start, clip.get("start_sec", start))
                end = max(end, clip.get("end_sec", end))
        return max(0, end - start)

    def _build_timeline_from_manifest(self, clip_manifest: list[dict]) -> dict[str, float]:
        """Build shot_id -> start_sec mapping."""
        return {
            clip["shot_id"]: clip.get("start_sec", 0)
            for clip in clip_manifest
        }


# ============================================================================
# Convenience
# ============================================================================

async def generate_audio(
    storyboard_path: str, clip_manifest_path: str, tts_name: str | None = None,
) -> dict:
    """Convenience: storyboard JSON + clip manifest -> audio manifest."""
    storyboard = load_json(storyboard_path)
    clip_manifest = load_json(clip_manifest_path)
    tts = create_tts_provider(tts_name)
    pipeline = AudioPipeline(tts)
    return await pipeline.generate_all(storyboard, clip_manifest)
