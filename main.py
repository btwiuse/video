#!/usr/bin/env -S uv run python
"""
AI 剧本到电影系统 — CLI 入口

用法:
    python main.py run <script_file>              # 全流程
    python main.py storyboard <script_file>       # 仅分镜
    python main.py assets <storyboard.json>       # 仅生成素材
    python main.py videos <storyboard.json> <assets.json>   # 仅生成视频
    python main.py audio <storyboard.json> <clips.json>     # 仅生成音频
    python main.py compose <clips.json> <audio.json>        # 仅后期合成
    python main.py summarize <script_file>        # 剧本摘要生成
    python main.py status                          # 查看输出目录状态
"""

import asyncio
import json
import logging
import sys
import time
from pathlib import Path

import click

from config import config
from src.utils import ensure_output_dir, load_json


def _setup_logging(debug: bool = False) -> None:
    """Configure logging with timestamps."""
    level = logging.DEBUG if debug else logging.INFO
    fmt = "%(asctime)s [%(levelname)-5s] %(name)s: %(message)s"
    logging.basicConfig(
        level=level,
        format=fmt,
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )
    # Quiet down noisy third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


@click.group()
@click.option("--debug/--no-debug", default=False, help="Enable debug logging")
@click.pass_context
def cli(ctx, debug):
    """AI-Powered Screenplay-to-Film Pipeline"""
    ctx.ensure_object(dict)
    ctx.obj["debug"] = debug
    _setup_logging(debug)


@cli.command()
@click.argument("script_file", type=click.Path(exists=True))
@click.option("--output", "-o", default=None, help="Output video path")
@click.option("--skip-step", multiple=True, type=click.Choice(["1", "2", "3", "4", "5"]),
              help="Skip specific steps")
def run(script_file, output, skip_step):
    """Run the full pipeline: script -> film."""
    script_path = Path(script_file).resolve()
    out_dir = ensure_output_dir()

    print(f"Input script: {script_path}")
    print(f"Output dir:  {out_dir}")
    print()

    # Step 1: Storyboard
    storyboard_path = out_dir / "storyboard.json"
    if "1" not in skip_step:
        print("=" * 60)
        print("STEP 1: Storyboard Generation (DeepSeek)")
        print("=" * 60)
        from src.step1_script_breakdown import generate_storyboard
        storyboard = generate_storyboard(str(script_path))
        shot_count = len(storyboard.get("shots", []))
        char_count = len(storyboard.get("characters", []))
        scene_count = len(storyboard.get("scenes", []))
        total_duration = sum(s.get("duration_sec", 0) for s in storyboard.get("shots", []))
        print(f"  Generated: {shot_count} shots, {char_count} characters, "
              f"{scene_count} scenes, ~{total_duration:.0f}s total")
    else:
        print("[SKIP] Step 1")
        storyboard = load_json(str(storyboard_path))

    # Step 2: Visual Assets
    assets_path = out_dir / "manifest.json"
    if "2" not in skip_step:
        print()
        print("=" * 60)
        print("STEP 2: Visual Asset Generation")
        print("=" * 60)
        from src.step2_visual_assets import generate_assets
        manifest = asyncio.run(generate_assets(str(storyboard_path)))
        print(f"  Generated assets: {len(manifest)} entries")
    else:
        print("[SKIP] Step 2")

    # Step 3: Video Generation
    clips_path = out_dir / "clip_manifest.json"
    if "3" not in skip_step:
        print()
        print("=" * 60)
        print("STEP 3: Video Generation (TokenVoke Seedance)")
        print("=" * 60)
        from src.step3_video_generation import generate_videos
        clip_manifest = asyncio.run(
            generate_videos(str(storyboard_path), str(assets_path))
        )
        done = sum(1 for c in clip_manifest if c.get("status") == "done")
        print(f"  Generated clips: {done}/{len(clip_manifest)} complete")
    else:
        print("[SKIP] Step 3")

    # Step 4: Audio
    audio_path = out_dir / "audio_manifest.json"
    if "4" not in skip_step:
        print()
        print("=" * 60)
        print("STEP 4: Audio Pipeline")
        print("=" * 60)
        from src.step4_audio import generate_audio
        audio_manifest = asyncio.run(
            generate_audio(str(storyboard_path), str(clips_path))
        )
        dialogue_count = len(audio_manifest.get("dialogue", []))
        ambience_count = len(audio_manifest.get("ambience", []))
        print(f"  Generated: {dialogue_count} dialogue lines, "
              f"{ambience_count} ambience tracks")
    else:
        print("[SKIP] Step 4")

    # Step 5: Compositing
    if "5" not in skip_step:
        print()
        print("=" * 60)
        print("STEP 5: Post-Production Compositing")
        print("=" * 60)
        from src.step5_postprocess import compose_film
        final_path = compose_film(
            str(clips_path),
            str(audio_path),
        )
        print(f"\nFinal film: {final_path}")
    else:
        print("[SKIP] Step 5")

    print()
    print("Pipeline complete.")


@cli.command()
@click.argument("script_file", type=click.Path(exists=True))
@click.option("--reasoning/--no-reasoning", default=None,
              help="Use DeepSeek reasoning model (R1, slower but deeper analysis)")
@click.pass_context
def storyboard(ctx, script_file, reasoning):
    """Generate storyboard only (Step 1)."""
    if reasoning is not None:
        config.DEEPSEEK_USE_REASONING = reasoning
    from src.step1_script_breakdown import generate_storyboard
    t0 = time.monotonic()
    storyboard = generate_storyboard(script_file)
    elapsed = time.monotonic() - t0
    shot_count = len(storyboard.get("shots", []))
    print(f"Storyboard: {shot_count} shots generated in {elapsed:.1f}s.")
    print(f"Output: {config.OUTPUT_DIR}/")


@cli.command()
@click.argument("storyboard_path", type=click.Path(exists=True))
@click.option("--regenerate-char", multiple=True, help="Regenerate specific character(s) by ref_id")
@click.option("--regenerate-char-image", multiple=True, help="Regenerate a specific character image by label (e.g. char1_front)")
@click.option("--regenerate-scene", multiple=True, help="Regenerate specific scene(s) by scene_id")
@click.option("--regenerate-scene-image", multiple=True, help="Regenerate a specific scene image by label (e.g. SC_01_wide)")
@click.option("--regenerate-shot", multiple=True, help="Regenerate specific shot(s) by full_shot_id")
@click.option("--regenerate-prop", multiple=True, help="Regenerate specific prop(s) by ref_id")
def assets(storyboard_path, regenerate_char, regenerate_char_image, regenerate_scene, regenerate_scene_image, regenerate_shot, regenerate_prop):
    """Generate visual assets only (Step 2)."""
    if regenerate_char or regenerate_char_image or regenerate_scene or regenerate_scene_image or regenerate_shot or regenerate_prop:
        from src.step2_visual_assets import regenerate_assets
        manifest = asyncio.run(regenerate_assets(
            storyboard_path,
            char_ids=list(regenerate_char),
            char_image_labels=list(regenerate_char_image),
            scene_ids=list(regenerate_scene),
            scene_image_labels=list(regenerate_scene_image),
            shot_ids=list(regenerate_shot),
            prop_ids=list(regenerate_prop),
        ))
        labels = []
        if regenerate_char:
            labels.append(f"{len(regenerate_char)} character(s)")
        if regenerate_char_image:
            labels.append(f"{len(regenerate_char_image)} image(s)")
        if regenerate_scene:
            labels.append(f"{len(regenerate_scene)} scene(s)")
        if regenerate_scene_image:
            labels.append(f"{len(regenerate_scene_image)} scene image(s)")
        if regenerate_shot:
            labels.append(f"{len(regenerate_shot)} shot(s)")
        if regenerate_prop:
            labels.append(f"{len(regenerate_prop)} prop(s)")
        print(f"Regenerated: {', '.join(labels)}.")
    else:
        from src.step2_visual_assets import generate_assets
        manifest = asyncio.run(generate_assets(storyboard_path))
        print(f"Assets: {len(manifest)} entries generated.")
    print(f"Output: {config.OUTPUT_DIR}/")


@cli.command()
@click.argument("storyboard_path", type=click.Path(exists=True))
@click.argument("assets_path", type=click.Path(exists=True))
def videos(storyboard_path, assets_path):
    """Generate video clips only (Step 3)."""
    from src.step3_video_generation import generate_videos
    clip_manifest = asyncio.run(generate_videos(storyboard_path, assets_path))
    done = sum(1 for c in clip_manifest if c.get("status") == "done")
    total = len(clip_manifest)
    print(f"Videos: {done}/{total} clips generated.")
    print(f"Output: {config.OUTPUT_DIR}/")
    if done == 0 and total > 0:
        print("ERROR: All video generations failed. See logs for details.", file=sys.stderr)
        raise SystemExit(1)


@cli.command()
@click.argument("storyboard_path", type=click.Path(exists=True))
@click.argument("clips_path", type=click.Path(exists=True))
def audio(storyboard_path, clips_path):
    """Generate audio only (Step 4)."""
    from src.step4_audio import generate_audio
    audio_manifest = asyncio.run(generate_audio(storyboard_path, clips_path))
    print(f"Audio: {len(audio_manifest.get('dialogue', []))} dialogue lines, "
          f"{len(audio_manifest.get('ambience', []))} ambience tracks.")
    print(f"Output: {config.OUTPUT_DIR}/")


@cli.command()
@click.argument("clips_path", type=click.Path(exists=True))
@click.argument("audio_path", type=click.Path(exists=True), required=False, default=None)
@click.option("--subtitles", "-s", default=None, help="SRT subtitles file")
@click.option("--lut", "-l", default=None, help="3D LUT file for color grading")
def compose(clips_path, audio_path, subtitles, lut):
    """Run post-production compositing only (Step 5)."""
    from src.step5_postprocess import compose_film
    final_path = compose_film(clips_path, audio_path, subtitles, lut)
    print(f"Final film: {final_path}")


@cli.command()
def status():
    """Show pipeline output status."""
    out_dir = Path(config.OUTPUT_DIR)
    if not out_dir.exists():
        print("No output directory yet. Run the pipeline first.")
        return

    steps = {
        "Step 1 (Storyboard)": out_dir / "storyboard.json",
        "Step 2 (Assets)": out_dir / "manifest.json",
        "Step 3 (Videos)": out_dir / "clip_manifest.json",
        "Step 4 (Audio)": out_dir / "audio_manifest.json",
        "Step 5 (Final)": out_dir / "final.mp4",
    }

    for step, path in steps.items():
        if path.exists():
            size = path.stat().st_size
            if size > 1024 * 1024:
                size_str = f"{size / (1024*1024):.1f} MB"
            elif size > 1024:
                size_str = f"{size / 1024:.1f} KB"
            else:
                size_str = f"{size} B"
            print(f"  ✅ {step}: {size_str}")
        else:
            print(f"  ⬜ {step}: not yet generated")


@cli.command("summarize")
@click.argument("script_file", type=click.Path(exists=True))
@click.option("--reasoning/--no-reasoning", default=None,
              help="Use DeepSeek reasoning model (R1)")
def summarize(script_file, reasoning):
    """Summarize a screenplay script into a short title/description."""
    if reasoning is not None:
        config.DEEPSEEK_USE_REASONING = reasoning

    script_text = Path(script_file).read_text(encoding="utf-8")
    from src.summarize import summarize_script
    result = summarize_script(script_text)
    print(json.dumps(result, ensure_ascii=False))


@cli.command()
@click.argument("storyboard_path", type=click.Path(exists=True))
def reindex(storyboard_path):
    """Rebuild storyboard.json from .md files (no AI calls)."""
    from src.reindex import reindex_storyboard
    t0 = time.monotonic()
    storyboard = reindex_storyboard(storyboard_path)
    elapsed = time.monotonic() - t0
    shot_count = len(storyboard.get("shots", []))
    print(f"Reindexed {shot_count} shots from .md files in {elapsed:.1f}s.")


if __name__ == "__main__":
    cli()
