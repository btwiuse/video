"""Utility functions shared across pipeline steps."""

import json
import os
import re
from pathlib import Path
from typing import Optional

from config import config


def ensure_output_dir(*subdirs: str) -> Path:
    """Create and return output subdirectory path."""
    path = Path(config.OUTPUT_DIR).joinpath(*subdirs)
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_script(filepath: str) -> str:
    """Load script text from file."""
    filepath = os.path.expanduser(filepath)
    with open(filepath, "r", encoding="utf-8") as f:
        return f.read()


def save_json(data: dict | list, filepath: str) -> None:
    """Save data as JSON with indentation."""
    filepath = os.path.expanduser(filepath)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_json(filepath: str) -> dict | list:
    """Load JSON from file."""
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_shot_id(shot_id: str) -> tuple[str, int]:
    """Parse shot ID like 'SC03_SHOT04' -> ('SC03', 4)."""
    match = re.match(r"(SC\d+)_SHOT(\d+)", shot_id)
    if not match:
        raise ValueError(f"Invalid shot ID: {shot_id}")
    return match.group(1), int(match.group(2))


def format_timestamp(seconds: float) -> str:
    """Format seconds to HH:MM:SS.mmm for FFmpeg."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"
