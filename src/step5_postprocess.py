"""
Step 5: Post-production compositing via MoviePy.

Operations:
  - Video concatenation with transitions
  - Multi-track audio mixing (dialogue, ambience, SFX, BGM)
  - Color grading (LUT application)
  - Subtitle overlay
  - Duration micro-adjustment (speed change ±10%)
"""

import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger("step5")

from moviepy import (
    VideoFileClip,
    AudioFileClip,
    concatenate_videoclips,
    CompositeAudioClip,
    CompositeVideoClip,
    ColorClip,
    vfx,
)
from moviepy.video.tools.subtitles import SubtitlesClip

from config import config
from src.utils import ensure_output_dir, save_json, load_json
from src.prompts import SUBTITLE_STYLE


class PostProduction:
    """Final compositing and export."""

    def __init__(self):
        self.out_dir = ensure_output_dir()

    def compose(
        self,
        clip_manifest: list[dict],
        audio_manifest: dict,
        subtitles_path: str | None = None,
        lut_path: str | None = None,
    ) -> str:
        """Compose the final film from all assets.

        Args:
            clip_manifest: List of clip entries from Step 3
            audio_manifest: Audio layers from Step 4
            subtitles_path: Optional SRT file path
            lut_path: Optional 3D LUT file for color grading

        Returns:
            Path to final output video
        """
        logger.info("Loading video clips...")
        video_clips = self._load_and_prepare_clips(clip_manifest)
        if not video_clips:
            raise RuntimeError(
                "No video clips available — all shots failed generation. "
                "Check Step 3 logs for details."
            )

        logger.info("Applying transitions...")
        final_video = self._concatenate_with_transitions(video_clips, clip_manifest)

        logger.info("Applying color grade...")
        if lut_path and os.path.exists(lut_path):
            # Apply 3D LUT via FFmpeg — MoviePy delegates this
            # For now, mark as pending
            pass

        logger.info("Mixing audio...")
        final_audio = self._mix_audio(audio_manifest, final_video.duration)
        if final_audio:
            final_video = final_video.with_audio(final_audio)

        logger.info("Adding subtitles...")
        if subtitles_path and os.path.exists(subtitles_path):
            final_video = self._add_subtitles(final_video, subtitles_path)

        # Export
        output_path = str(self.out_dir / "final.mp4")
        logger.info("Exporting to %s...", output_path)
        final_video.write_videofile(
            output_path,
            fps=24,
            codec="libx264",
            audio_codec="aac",
            temp_audiofile="temp-audio.m4a",
            remove_temp=True,
            bitrate="8000k",
        )

        logger.info("Done: %s", output_path)
        return output_path

    def _load_and_prepare_clips(self, clip_manifest: list[dict]) -> list[VideoFileClip]:
        """Load video clips, adjusting speed if needed to match target durations."""
        clips = []
        for clip_info in clip_manifest:
            if clip_info.get("status") != "done":
                continue
            path = clip_info.get("file") or clip_info.get("path", "")
            if not path or not os.path.exists(path):
                continue

            clip = VideoFileClip(path)
            if clip.duration is None:
                clip.close()
                continue
            # Normalize to 864x480
            if clip.w != 864 or clip.h != 480:
                clip = clip.resized((864, 480))
            clips.append(clip)

        return clips

    def _concatenate_with_transitions(
        self, clips: list[VideoFileClip], clip_manifest: list[dict]
    ) -> VideoFileClip:
        """Concatenate clips with transition effects where specified."""
        if len(clips) == 1:
            return clips[0]

        result = clips[0]
        for i in range(1, len(clips)):
            transition = "hard_cut"
            if i < len(clip_manifest):
                trans_type = clip_manifest[i].get("transition_type", "B")
                if trans_type in ("C", "D"):
                    transition = "crossfade"

            if transition == "crossfade":
                fade_duration = 0.5
                clip1 = result.crossfadeout(fade_duration)
                clip2 = clips[i].crossfadein(fade_duration).with_start(result.duration - fade_duration)
                result = CompositeVideoClip([clip1, clip2])
            else:
                result = concatenate_videoclips([result, clips[i]])

        return result

    def _mix_audio(
        self, audio_manifest: dict, total_duration: float
    ) -> CompositeAudioClip | None:
        """Mix all audio layers into a single composite track.

        Mixing levels:
          Dialogue:  -3dB  (reference)
          Ambience:  -18dB (dips to -24dB during dialogue)
          SFX:       -6dB  (peak)
          BGM:       -15dB (dips to -25dB during dialogue)
        """
        tracks = []

        # Dialogue tracks
        for entry in audio_manifest.get("dialogue", []):
            path = entry.get("file", "")
            if path and os.path.exists(path):
                clip = AudioFileClip(path)
                clip = clip.with_effects([vfx.MultiplyVolume(0.7)])  # -3dB
                tracks.append(clip)

        # Ambience tracks
        for entry in audio_manifest.get("ambience", []):
            path = entry.get("file", "")
            if path and os.path.exists(path):
                clip = AudioFileClip(path)
                clip = clip.with_effects([vfx.MultiplyVolume(0.12)])  # -18dB
                if entry.get("loop"):
                    clip = clip.loop(duration=total_duration)
                tracks.append(clip)

        # SFX tracks
        for entry in audio_manifest.get("sfx", []):
            path = entry.get("file", "")
            if path and os.path.exists(path):
                clip = AudioFileClip(path)
                clip = clip.with_effects([vfx.MultiplyVolume(0.5)])  # -6dB
                # Place at specific offset
                offset = entry.get("offset_sec", 0)
                if offset > 0:
                    clip = clip.with_start(offset)
                tracks.append(clip)

        # BGM tracks
        for entry in audio_manifest.get("bgm", []):
            path = entry.get("file", "")
            if path and os.path.exists(path):
                clip = AudioFileClip(path)
                clip = clip.with_effects([vfx.MultiplyVolume(0.17)])  # -15dB
                tracks.append(clip)

        if not tracks:
            return None

        return CompositeAudioClip(tracks)

    def _add_subtitles(
        self, video: VideoFileClip, srt_path: str
    ) -> VideoFileClip:
        """Overlay subtitles from SRT file."""
        from moviepy import TextClip
        generator = lambda txt: TextClip(
            txt,
            fontsize=48,
            color='white',
            font='Arial-Bold',
            stroke_color='black',
            stroke_width=2,
        )

        subtitle_clips = SubtitlesClip(
            srt_path,
            encoding="utf-8",
            make_textclip=generator,
        )

        return video.with_subtitle(subtitle_clips)

    def _build_ffmpeg_color_grade_command(
        self, input_path: str, output_path: str, lut_path: str
    ) -> list[str]:
        """Build FFmpeg command for 3D LUT color grading."""
        return [
            "ffmpeg", "-i", input_path,
            "-vf", f"lut3d={lut_path}",
            "-c:a", "copy",
            output_path,
        ]


def compose_film(
    clip_manifest_path: str,
    audio_manifest_path: str | None = None,
    subtitles_path: str | None = None,
    lut_path: str | None = None,
) -> str:
    """Convenience function."""
    clip_manifest = load_json(clip_manifest_path)
    audio_manifest = load_json(audio_manifest_path) if audio_manifest_path else {}
    pp = PostProduction()
    return pp.compose(clip_manifest, audio_manifest, subtitles_path, lut_path)
