"""
Prompt templates — all knowledge has been moved to skills/.
Only assembly logic remains for backward compatibility.
"""

from src.skills import get_skill_manager


def assemble_video_prompt(shot: dict) -> str:
    """Assemble the positive video prompt from shot data fields."""
    parts = []

    # Camera specs
    cam_parts = []
    if shot.get("shot_size"):
        cam_parts.append(shot["shot_size"])
    if shot.get("camera_angle"):
        cam_parts.append(shot["camera_angle"])
    if shot.get("camera_move"):
        cam_parts.append(shot["camera_move"])
    if cam_parts:
        parts.append(", ".join(cam_parts) + ".")

    # Visual description (the bulk from DeepSeek output)
    if shot.get("visual_description"):
        parts.append(shot["visual_description"])

    # Character references
    if shot.get("character_refs"):
        parts.append("Character reference: " + shot["character_refs"])

    # Continuity
    if shot.get("continuity_note"):
        parts.append(shot["continuity_note"])

    # Aspect ratio
    parts.append("16:9, 1080p.")

    return " ".join(parts)


def get_negative_prompt() -> str:
    """Load negative prompt from video skill."""
    sm = get_skill_manager()
    try:
        return sm.get_template("video", "negative_prompt")
    except KeyError:
        return ""


def get_image_template(name: str) -> str:
    """Load an image prompt template from image skill."""
    sm = get_skill_manager()
    return sm.get_template("image", name)


def get_audio_template(name: str) -> str:
    """Load an audio prompt template from audio skill."""
    sm = get_skill_manager()
    return sm.get_template("audio", name)

