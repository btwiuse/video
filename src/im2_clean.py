"""
IM2 Clean Image — prompt post-processing layer for image generation.

Applies material-light, clean rendering, and negative hygiene to any base prompt.
Model-agnostic; works with Flux, Seedream, StepFun, ComfyUI, etc.

Templates are loaded from skills/_pipeline/image/_clean_*.md via SkillManager.
"""

import logging

logger = logging.getLogger("im2_clean")

# Lazy-loaded from skill templates
_loaded = False
_character_material = ""
_scene_material = ""
_prop_material = ""
_universal_quality = ""
_clean_rendering = ""
_avoid_default = ""
_material_map: dict[str, str] = {}


def _ensure_loaded():
    global _loaded, _character_material, _scene_material, _prop_material
    global _universal_quality, _clean_rendering, _avoid_default, _material_map
    if _loaded:
        return
    from src.prompts import get_image_template
    _character_material = get_image_template("_clean_character_material")
    _scene_material = get_image_template("_clean_scene_material")
    _prop_material = get_image_template("_clean_prop_material")
    _universal_quality = get_image_template("_clean_universal_quality")
    _clean_rendering = get_image_template("_clean_rendering")
    _avoid_default = get_image_template("_clean_avoid")
    _material_map = {
        "character": _character_material,
        "scene": _scene_material,
        "prop": _prop_material,
    }
    _loaded = True
    logger.info("IM2 clean templates loaded (%d)", len(_material_map) + 3)


def _detect_material_block(prompt: str, image_type: str = "general") -> str:
    """Pick the best material module based on prompt content and type hint."""
    _ensure_loaded()
    # Use type hint first
    if image_type in _material_map:
        return _material_map[image_type]
    # Fallback to keyword detection
    prompt_lower = prompt.lower()
    for keywords, block in [  # ordered: most specific first
        (("face", "portrait", "skin", "hair", "character", "chest-up"), _character_material),
        (("building", "architecture", "room", "street", "landscape", "interior", "exterior"), _scene_material),
        (("prop", "product", "isolated", "object", "weapon", "item"), _prop_material),
    ]:
        if any(kw in prompt_lower for kw in keywords):
            return block
    return ""


def apply_im2_clean(
    prompt: str,
    image_type: str = "general",
    *,
    include_avoid: bool = True,
    custom_avoid: str | None = None,
) -> str:
    """Apply IM2 clean image layers to a base prompt.

    Args:
        prompt: The base image prompt (from templates or .md files).
        image_type: One of 'character', 'scene', 'prop', 'general'.
        include_avoid: Whether to append the avoid block.
        custom_avoid: Override the default avoid block.

    Returns:
        Enhanced prompt with material-light + clean rendering + avoid.
    """
    _ensure_loaded()
    parts = [prompt.strip()]

    logger.debug("IM2 clean applied [type=%s]: %.120s...", image_type, prompt.strip())

    # 1. Material-light layer (conditional)
    material_block = _detect_material_block(prompt, image_type)
    if material_block:
        parts.append(material_block)

    # 2. Universal material quality
    parts.append(_universal_quality)

    # 3. Clean rendering layer
    parts.append(_clean_rendering)

    # 4. Negative hygiene (compact avoid block)
    if include_avoid:
        parts.append(custom_avoid or _avoid_default)

    return ". ".join(parts)


def apply_im2_clean_to_prompts(
    prompts: list[tuple[str, str, str]],
    image_type: str = "general",
) -> list[tuple[str, str, str]]:
    """Apply IM2 clean to a batch of (prompt, label, aspect_ratio) tuples."""
    return [
        (apply_im2_clean(prompt, image_type), label, ar)
        for prompt, label, ar in prompts
    ]
