# AGENTS.md

## Project Overview

AI Screenplay-to-Film Pipeline (AI 剧本到电影系统). Inputs a Chinese screenplay (`.txt`) and outputs a complete short film (`.mp4`) via a 5-step AI pipeline. Runs as a Click CLI. Python 3.10+.

## Essential Commands

```bash
pip install -r requirements.txt
cp .env.example .env   # edit with API keys
python main.py run test_script.txt
python main.py status
```

CLI subcommands: `run`, `storyboard`, `assets`, `videos`, `audio`, `compose`, `status`.

Useful flags:
- `--skip-step 1` (repeatable, values 1-5)
- `--reasoning` / `--no-reasoning` on `storyboard` to toggle DeepSeek R1
- `--debug` for verbose logging
- `OUTPUT_DIR=./output` env var to change output location

No Makefile, no CI, no test runner configured. `tests/test_pipeline.py` contains manual validation functions.

## Architecture & Data Flow

Five sequential steps communicate through JSON files in `output/`:

```
script.txt -> storyboard.json -> manifest.json -> clip_manifest.json -> audio_manifest.json -> final.mp4
```

Each step can run independently by passing the previous step's JSON output. Steps skip generation if output files already exist (resumable).

### Step internals
- **Step 1** (`src/step1_script_breakdown.py`): Synchronous. Uses DeepSeek tool calling (4 phases: overview, characters, scenes, shots). Outputs `storyboard.json` plus per-shot `.md` files under `output/shots/<shot_id>/`.
- **Step 2** (`src/step2_visual_assets.py`): Async. Generates character portraits (3 angles) and scene reference images. Uses `ImageProvider` ABC.
- **Step 3** (`src/step3_video_generation.py`): Async. Reads shot `.md` as the primary prompt source. Falls back to `assemble_video_prompt(shot)` if `.md` missing. Uses `VideoProvider` ABC.
- **Step 4** (`src/step4_audio.py`): Async. Generates dialogue (TTS), ambience, SFX, BGM. Uses `TTSProvider` ABC.
- **Step 5** (`src/step5_postprocess.py`): Synchronous. MoviePy compositing: concatenation, audio mixing, subtitles, color grade (LUT via FFmpeg command builder, but MoviePy LUT path is stubbed).

## Code Organization

```
src/
  step1_script_breakdown.py   # LLM-driven storyboard generation
  step2_visual_assets.py      # Image providers (Replicate, Seedream, ComfyUI)
  step3_video_generation.py   # Video providers (Seedance)
  step4_audio.py              # Audio/TTS providers (ElevenLabs)
  step5_postprocess.py        # MoviePy final compositing
  prompts.py                  # Shared prompt templates and constants
  utils.py                    # Path helpers, JSON I/O, timestamp formatting
```

`config.py` is a plain class (not Pydantic) loaded from `.env` via `python-dotenv`. Module-level singleton `config = Config()`.

## Critical Patterns

### Provider Registry
Each generation step uses the same pattern:
1. Abstract base class (`ImageProvider`, `VideoProvider`, `TTSProvider`) with a `generate()` coroutine.
2. Concrete providers (e.g., `SeedanceProvider`, `ElevenLabsProvider`).
3. A module-level `_PROVIDER_REGISTRY: dict[str, type[...]]`.
4. Factory function `create_*_provider(name)` that reads from config or accepts explicit override.
5. `Null*Provider` implementations that skip API calls for testing.

To add a new provider, subclass the ABC, implement `generate()`, register in `_PROVIDER_REGISTRY`, and ensure the API key is exposed in `config.py`.

### Shot Prompt Chain
Step 3 does **not** primarily use the JSON `positive_prompt` field. It reads the full `.md` file saved by Step 1 as the generation prompt. Only if the `.md` is missing does it call `assemble_video_prompt(shot)`. This means:
- Manual edits to `output/shots/<shot_id>/<shot_id>.md` directly affect video generation.
- The `.md` file contains all shot metadata, dialogue, sfx, and visual descriptions in one human-readable place.

### Checkpoint / Resume
Every step checks for existing output files before generating. A failed API call leaves no partial file, so simply rerunning the step retries only failed items. `--skip-step` lets you bypass completed steps.

### Transition Types and Image Quotas
- Transition `A` (continuous action): previous shot's start frame is passed as a reference image.
- Transition `B` (angle change): character portraits + scene refs only.
- Transition `C` / `D`: time/space jump, no continuity frame.
- `SEEDANCE_MAX_IMAGES` (default 9) limits how many reference images are sent to Seedance. The quota is shared across character portraits, scene refs, and continuity frames.

### Error Handling
- HTTP 403 and 400 (content moderation) are retried with exponential backoff (`2 ** attempt`).
- Non-200 responses return `VideoResult(status="failed", error=...)`.
- Step 1 JSON parsing failures save raw responses to `output/_debug/` and raise `RuntimeError`.

### Concurrency
Steps 2-4 use `asyncio.run()` in `main.py`. Providers use `httpx.AsyncClient`. Image/video providers generate batches concurrently via `asyncio.gather(..., return_exceptions=True)`.

## Gotchas

- **Mixed sync/async**: `main.py` is sync; steps 2, 3, 4 are async and wrapped in `asyncio.run()`. Step 1 and 5 are sync.
- **Shared API key fallback**: `VIDEO_API_KEY` falls back to `IMAGE_API_KEY` (`config.py:25`). If both are empty, Seedance will fail at runtime.
- **MoviePy stubs**: Subtitles and LUT color grading are partially implemented or stubbed in `step5_postprocess.py`. The `_build_ffmpeg_color_grade_command` builds a command list but it is never invoked.
- **TTS voice fallback**: `ElevenLabsProvider._get_or_create_voice` returns a hardcoded voice ID `"21m00Tcm4TlvDq8ikWAM"`. Voice cloning is not implemented.
- **Step 1 streaming**: `_call_chat` and `_call_tool` stream responses but do not expose partial output. If the model times out or the connection drops, the whole call must be retried.
- **No tests**: `tests/test_pipeline.py` defines validation functions but no test runner is configured. Run them manually by importing.
- **UTF-8 everywhere**: Scripts, prompts, and JSON use UTF-8. No BOM handling.

## Naming & Style Conventions

- Python 3.10+ syntax: `dict[str, Any]`, `list[str]`, `str | None`.
- `from __future__ import annotations` used selectively in `step2`, `step3`, `step4`.
- Logging uses module-level loggers (`logger = logging.getLogger("step1")`).
- Output paths use `pathlib.Path` and `os.path` interchangeably. Prefer `pathlib` for new code.
- Shot IDs: `SC01_SHOT03`, scenes: `SC_01`.
- Intermediate filenames are fixed by convention (`storyboard.json`, `manifest.json`, `clip_manifest.json`, `audio_manifest.json`, `final.mp4`).

## Environment Variables

Required for full pipeline: `DEEPSEEK_API_KEY`, `IMAGE_API_KEY`, `VIDEO_API_KEY`, `AUDIO_API_KEY`. Each step fails gracefully if its provider key is missing, but downstream steps that depend on upstream artifacts will fail if artifacts are absent.

Key limits:
- `SEEDANCE_MAX_DURATION_SEC = 15` (clamped to API range [4, 10] internally)
- `SEEDANCE_MAX_IMAGES = 9`
- `MAX_SCENE_DURATION_SEC = 600`
