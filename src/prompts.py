"""
Prompt templates — all knowledge has been moved to skills/.
Only assembly logic remains for backward compatibility.
"""

from src.skills import get_skill_manager


def assemble_video_prompt(shot: dict) -> str:
    """Assemble the positive video prompt from shot data fields."""
    # The full video prompt (web editor's "视频提示词/镜头动作" field) is
    # canonical when present; structured fields below are only its building
    # blocks for older shots that lack it.
    if shot.get("positive_prompt"):
        prompt = shot["positive_prompt"]
        if shot.get("continuity_note"):
            prompt += " " + shot["continuity_note"]
        return prompt.strip() + " 16:9, 1080p."

    parts = []

    # Action beats from Step 1 (shots without a full positive_prompt)
    if shot.get("action_description"):
        parts.append(shot["action_description"])

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
        refs = shot["character_refs"]
        if isinstance(refs, list):
            refs = ", ".join(str(r) for r in refs)
        parts.append("Character reference: " + refs)

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

