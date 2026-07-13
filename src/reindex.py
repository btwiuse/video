"""Rebuild storyboard.json from existing .md files without calling AI.

Usage:
    python -c "from src.reindex import reindex_storyboard; reindex_storyboard('output/dir/storyboard.json')"
"""

import logging
import os
import re

from src.utils import load_json, save_json

logger = logging.getLogger("reindex")

# Regex patterns for parsing shot .md files
_RE_DURATION = re.compile(r"\|\s*时长\s*\|\s*([\d.]+)s\s*\|")
_RE_TRANSITION = re.compile(r"\|\s*衔接\s*\|\s*([A-Da-d])\s*\|")
_RE_SHOT_SIZE = re.compile(r"\|\s*景别\s*\|\s*(.+?)\s*\|")
_RE_DIALOGUE = re.compile(r"^-\s*对白[：:]\s*(.+)", re.MULTILINE)
_RE_ACTION_HEADER = re.compile(r"^##\s+动作\s*$", re.MULTILINE)
_RE_PROMPT_HEADER = re.compile(r"^##\s+视频 Prompt[（(]正面[）)]\s*$", re.MULTILINE)
_RE_CHAR_NAME = re.compile(r"^-\s*姓名[：:]\s*(.+)", re.MULTILINE)

_SENTINEL_NONE = "（无）"


def _extract_section(text: str, header_pattern: re.Pattern) -> str:
    """Extract content after a header until the next ## header (or EOF)."""
    m = header_pattern.search(text)
    if not m:
        return ""
    start = m.end()
    end_m = re.search(r"^##\s", text[start:], re.MULTILINE)
    if end_m:
        return text[start:start + end_m.start()].strip()
    return text[start:].strip()


def _strip_fences(text: str) -> str:
    """Strip surrounding ``` fences from a code block."""
    text = text.strip()
    if text.startswith("```"):
        text = text[3:].strip()
    if text.endswith("```"):
        text = text[:-3].strip()
    return text


def _extract_dialogue(text: str) -> str:
    """Extract dialogue line from audio section."""
    m = _RE_DIALOGUE.search(text)
    if m:
        val = m.group(1).strip()
        return "" if val == _SENTINEL_NONE else val
    return ""


def _not_sentinel(val: str) -> bool:
    """Return True if val is a real value (not the empty sentinel)."""
    v = val.strip()
    return bool(v) and v != _SENTINEL_NONE


def reindex_storyboard(storyboard_path: str) -> dict:
    """Rebuild storyboard.json from .md files.

    Reads the existing storyboard.json to preserve shot order and structure,
    then updates fields from the corresponding .md files.
    Returns the updated storyboard dict.
    """
    output_dir = os.path.dirname(os.path.abspath(storyboard_path))
    storyboard = load_json(storyboard_path)

    # Rebuild characters from character .md files
    char_dir = os.path.join(output_dir, "characters")
    if os.path.isdir(char_dir):
        seen = set()
        new_chars = []
        for c in storyboard.get("characters", []):
            ref_id = c["ref_id"]
            if ref_id in seen:
                continue
            seen.add(ref_id)
            md_path = os.path.join(char_dir, f"{ref_id}.md")
            name = c.get("name", ref_id)
            if os.path.isfile(md_path):
                try:
                    with open(md_path, "r", encoding="utf-8") as f:
                        content = f.read()
                    name_m = _RE_CHAR_NAME.search(content)
                    if name_m:
                        name = name_m.group(1).strip()
                except OSError:
                    pass
            new_chars.append({"ref_id": ref_id, "name": name})
        storyboard["characters"] = new_chars

    # Rebuild shots from shot .md files
    updated_shots = []
    for shot in storyboard.get("shots", []):
        shot_id = shot["full_shot_id"]
        md_path = os.path.join(output_dir, "shots", shot_id, f"{shot_id}.md")

        if os.path.isfile(md_path):
            try:
                with open(md_path, "r", encoding="utf-8") as f:
                    content = f.read()

                # Table fields (no sentinel values)
                dur_m = _RE_DURATION.search(content)
                if dur_m:
                    shot["duration_sec"] = float(dur_m.group(1))

                trans_m = _RE_TRANSITION.search(content)
                if trans_m:
                    shot["transition_type"] = trans_m.group(1)

                size_m = _RE_SHOT_SIZE.search(content)
                if size_m:
                    shot["shot_size"] = size_m.group(1).strip()

                # Section fields
                action = _extract_section(content, _RE_ACTION_HEADER)
                if _not_sentinel(action):
                    shot["action_description"] = action
                elif "action_description" in shot:
                    del shot["action_description"]

                prompt_raw = _extract_section(content, _RE_PROMPT_HEADER)
                prompt = _strip_fences(prompt_raw) if prompt_raw else ""
                if prompt:
                    shot["positive_prompt"] = prompt
                elif "positive_prompt" in shot:
                    del shot["positive_prompt"]

                dialogue = _extract_dialogue(content)
                if dialogue:
                    shot["dialogue_line"] = dialogue
                elif "dialogue_line" in shot:
                    del shot["dialogue_line"]

            except OSError as e:
                logger.warning("Failed to read %s: %s", md_path, e)

        updated_shots.append(shot)

    storyboard["shots"] = updated_shots

    save_json(storyboard, storyboard_path)
    logger.info("Reindexed %d shots, %d characters", len(updated_shots), len(storyboard.get("characters", [])))
    return storyboard
