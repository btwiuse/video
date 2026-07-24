"""
Step 1: Script parsing and storyboard generation via DeepSeek (Tool Calling).

Five phases, each producing structured JSON via function calling:
  Phase 1 — extract_script_overview  (1 call)  → character, scene, and prop lists
  Phase 2 — define_character          (N calls) → per-character portrait + prompts
  Phase 3 — define_prop               (P calls) → per-prop continuity definition
  Phase 4 — define_scene              (M calls) → per-scene reference + prompts
  Phase 5 — create_scene_shot         (N calls) → one call per shot, per-shot prompts

Each tool call's output is saved directly as an individual file.
"""

import asyncio
import json
import logging
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from openai import OpenAI

from config import config
from src.utils import ensure_output_dir, save_json
from src.skills import get_skill_manager

logger = logging.getLogger("step1")

# ============================================================================
# Film grammar knowledge (shared across all phases)
# ============================================================================

def _load_film_grammar() -> str:
    """Load film knowledge from pipeline's own storyboard skill (with external skill as enhancement)."""
    sm = get_skill_manager()
    # Primary: pipeline's own Chinese film grammar (exact original content)
    try:
        return sm.get_template("storyboard", "film_grammar")
    except KeyError:
        pass
    # Fallback: external skill
    body = sm.inject("cinematic-audiovisual-language")
    if body:
        return body
    return ""

# ============================================================================
# Tool definitions (JSON Schema for function calling)
# ============================================================================

TOOL_DEFINE_CHARACTER = {
    "type": "function",
    "function": {
        "name": "define_character",
        "description": "为一个角色生成完整视觉设定，包括外貌、服装、定妆照 prompt。",
        "parameters": {
            "type": "object",
            "properties": {
                "ref_id": {"type": "string", "description": "角色引用ID"},
                "name": {"type": "string", "description": "角色名"},
                "age": {"type": "string", "description": "年龄描述"},
                "gender": {"type": "string", "description": "性别"},
                "height_build": {"type": "string", "description": "身高体型"},
                "face": {"type": "string", "description": "脸型、五官、肤色细节"},
                "hair": {"type": "string", "description": "发型发色"},
                "distinctive_features": {"type": "string", "description": "标志特征（痣、伤疤、配饰等）"},
                "clothing": {"type": "string", "description": "服装完整描述"},
                "voice_quality": {"type": "string", "description": "音色、语速、说话习惯"},
                "personality": {"type": "string", "description": "性格关键词"},
                "portrait_front_prompt": {"type": "string", "description": "正面胸像定妆照中文 prompt，含 studio lighting / 85mm / photorealistic / 8K"},
                "portrait_profile_prompt": {"type": "string", "description": "45°侧面胸像中文 prompt"},
                "fullbody_prompt": {"type": "string", "description": "全身站立照中文 prompt，含完整服装"},
            },
            "required": ["ref_id", "name", "face", "hair", "clothing", "portrait_front_prompt", "portrait_profile_prompt", "fullbody_prompt"],
        },
    },
}

TOOL_DEFINE_SCENE = {
    "type": "function",
    "function": {
        "name": "define_scene",
        "description": "为一个场景生成完整的空间、光线、色彩设定和参考图 prompt。",
        "parameters": {
            "type": "object",
            "properties": {
                "scene_id": {"type": "string", "description": "场景ID"},
                "name": {"type": "string", "description": "场景名称"},
                "location_type": {"type": "string", "description": "内景/外景"},
                "time_period": {"type": "string", "description": "时间"},
                "spatial_description": {"type": "string", "description": "空间布局，面积，关键物件位置与方向"},
                "lighting_primary": {"type": "string", "description": "主光源类型/方向/色温"},
                "lighting_fill": {"type": "string", "description": "辅光来源"},
                "lighting_ratio": {"type": "string", "description": "光比"},
                "color_dominant": {"type": "string", "description": "主导色+情感关联"},
                "color_accent": {"type": "string", "description": "点缀色"},
                "visual_reference": {"type": "string", "description": "质感/影片参照"},
                "ambience_sound": {"type": "string", "description": "环境音描述"},
                "scene_wide_prompt": {"type": "string", "description": "场景主视角广角图中文 prompt，无人，16:9，photorealistic，8K"},
                "scene_detail_prompt": {"type": "string", "description": "场景关键元素特写中文 prompt"},
            },
            "required": ["scene_id", "name", "spatial_description", "lighting_primary", "color_dominant", "scene_wide_prompt"],
        },
    },
}

TOOL_DEFINE_PROP = {
    "type": "function",
    "function": {
        "name": "define_prop",
        "description": "为一个叙事关键道具生成可跨镜头复用的视觉与连续性设定。",
        "parameters": {
            "type": "object",
            "properties": {
                "ref_id": {"type": "string", "description": "道具引用 ID，使用 PROP_01、PROP_02 等稳定编号"},
                "name": {"type": "string", "description": "道具名称"},
                "category": {"type": "string", "description": "类别，如手持物、武器、信物、交通工具、关键陈设"},
                "narrative_function": {"type": "string", "description": "叙事功能和重要性"},
                "visual_description": {"type": "string", "description": "完整外观、形状、结构和可辨识细节"},
                "material_and_condition": {"type": "string", "description": "材质、表面质感、新旧程度、磨损或污渍"},
                "dimensions": {"type": "string", "description": "相对或实际尺寸、比例和重量感"},
                "color_palette": {"type": "string", "description": "主色、辅色、反光或发光特征"},
                "distinctive_features": {"type": "string", "description": "铭文、划痕、机关、标志、缺口等唯一特征"},
                "handling_notes": {"type": "string", "description": "角色如何持握、佩戴、摆放或操作；无则说明"},
                "continuity_rules": {"type": "string", "description": "跨镜头必须保持不变的外观、位置、状态；并标注剧本中发生的状态变化"},
                "scene_appearances": {"type": "array", "items": {"type": "string"}, "description": "出现的场景 ID 列表"},
                "reference_prompt": {"type": "string", "description": "道具参考图中文 prompt：孤立展示、清晰材质和全部关键特征、无人物"},
            },
            "required": ["ref_id", "name", "category", "visual_description", "material_and_condition", "continuity_rules", "reference_prompt"],
        },
    },
}

TOOL_CREATE_SHOT = {
    "type": "function",
    "function": {
        "name": "create_scene_shot",
        "description": "生成场景中的单个分镜，包含完整的视觉/光影/色彩/构图/空间/音频规格和视频/起始帧 prompt。每次调用只生成一个镜头。",
        "parameters": {
            "type": "object",
            "properties": {
                "scene_id": {"type": "string", "description": "所属场景ID"},
                "shot_num": {"type": "integer", "description": "本镜头在场景中的序号，从1开始"},
                "is_scene_end": {"type": "boolean", "description": "true 表示这是该场景的最后一个镜头，本场景后续不再有镜头"},
                "duration_sec": {"type": "number", "description": "单镜头时长（秒），总时长 = 所有镜头 duration_sec 之和。注意：4-10 秒为佳，对话/独白镜头建议 8-10 秒，动作/过渡镜头 4-6 秒"},
                "transition_type": {"type": "string", "enum": ["A", "B", "C", "D", "起始镜"], "description": "衔接类型"},
                "shot_size": {"type": "string", "description": "景别"},
                "camera_position": {"type": "string", "description": "机位描述"},
                "camera_movement": {"type": "string", "description": "运镜描述"},
                "action_description": {"type": "string", "description": "镜头内的完整动作流程，按时间顺序每行一段，每行以时间标记开头（如【0-3秒】或 0-3秒：）。这是视频模型最核心的输入——视频是运动媒介，没有清晰的运动描述就得不到有意义的视频。每个镜头至少写3段。"},
                "visual_foreground": {"type": "string", "description": "前景内容"},
                "visual_subject": {"type": "string", "description": "主体（角色位置、表情、状态——不含运动，运动写在 action_description 中）"},
                "visual_background": {"type": "string", "description": "背景内容"},
                "visual_details": {"type": "string", "description": "关键细节"},
                "lighting_key": {"type": "string", "description": "主光"},
                "lighting_fill": {"type": "string", "description": "辅光"},
                "lighting_ratio": {"type": "string", "description": "光比"},
                "lighting_mood": {"type": "string", "description": "光线氛围"},
                "color_dominant": {"type": "string", "description": "主导色"},
                "color_accent": {"type": "string", "description": "点缀色"},
                "color_reference": {"type": "string", "description": "质感参照"},
                "composition_depth": {"type": "string", "description": "纵深层次"},
                "composition_anchor": {"type": "string", "description": "视觉锚点"},
                "composition_direction": {"type": "string", "description": "屏幕方向和角色位置"},
                "spatial_position": {"type": "string", "description": "角色位置与朝向"},
                "spatial_continuity_prev": {"type": "string", "description": "与上一镜的空间衔接说明，镜头1则标注'起始镜'"},
                "spatial_continuity_next": {"type": "string", "description": "为下一镜预留的空间/视线线索，若是场景末镜则标注'场景结束，跳下一场'"},
                "dialogue_line": {"type": "string", "description": "台词（含角色名和语气标注），无则留空"},
                "sfx_marks": {"type": "string", "description": "音效标记和时间点，无则留空"},
                "character_refs": {"type": "array", "items": {"type": "string"}, "description": "本镜头涉及的角色 ref_id 列表"},
                "prop_refs": {"type": "array", "items": {"type": "string"}, "description": "本镜头中实际可见、被持握或被操作的关键道具 ref_id 列表；无则为空数组。不要填写普通背景陈设"},
                "positive_prompt": {"type": "string", "description": "视频生成正面 prompt，用中文描述，详细到景别/运镜/角色(Image引用)/动作/光影/色彩/质感/画幅"},
                "negative_prompt": {"type": "string", "description": "视频生成负面 prompt，用中文描述"},
                "start_frame_prompt": {"type": "string", "description": "起始帧图片 prompt，用于文生图模型生成该镜头的第一帧静止图片。与 positive_prompt 的唯一区别：(1) 16:9 画幅 (2) 去掉所有运镜/运动描述——只描述一个静止瞬间。"},
            },
            "required": ["scene_id", "shot_num", "is_scene_end", "duration_sec", "transition_type", "shot_size", "camera_position", "camera_movement", "action_description", "visual_subject", "positive_prompt", "negative_prompt", "start_frame_prompt"],
        },
    },
}

# ============================================================================
# System prompts for each phase
# ============================================================================

def _build_system_filmmaker() -> str:
    """Build the filmmaker system prompt with skill-injected knowledge."""
    film_knowledge = _load_film_grammar()
    return f"""你是一位资深电影导演和分镜师，精通视觉叙事和 AI 视频生成（Seedance 2.0）。

## 你的电影知识体系
{film_knowledge}

## 核心原则

### 视频 prompt（positive_prompt / negative_prompt）
1. 动作描述是视频 prompt 的核心——视频是运动媒介，没有运动就没有视频。必须详细描述镜头内每一段时间内的动作：角色如何移动、做什么、肢体和表情如何变化
2. 具体视觉细节，不要抽象情绪词
3. 视频 prompt 中引用角色时用 "see {{角色ref_id}} for reference" 格式（ref_id 就是角色原名）
4. 出现关键道具时必须遵守道具设定中的材质、颜色、尺寸和状态；只在道具实际可见、被持握或被操作时写入 prop_refs
5. 包含景别/运镜描述
6. 光影/色彩/质感描述作为辅助，但不应占据超过 prompt 30% 的篇幅
7. **用中文写 positive_prompt 和 negative_prompt（和剧本语言保持一致）**

### 起始帧 prompt（start_frame_prompt）
1. 与 positive_prompt 的唯一区别：去掉运镜/运动描述，只描述静止瞬间
2. 16:9 画幅

### 通用
- 相邻镜头的光线、色彩、空间关系必须自洽
- 对话场景严格遵守 180 度规则"""


def _ensure_list(value: list | str | None) -> list[str]:
    """Normalize character_refs to a list of strings.

    The LLM sometimes returns a JSON string like '[\"小橘\"]' instead of
    an actual list, which causes ', '.join() to iterate character-by-character.
    """
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        import json as _json
        try:
            parsed = _json.loads(value)
            if isinstance(parsed, list):
                return parsed
        except (_json.JSONDecodeError, TypeError):
            pass
        # Fallback: if it's a bare string, wrap it in a list
        return [value]
    return []


class StoryboardGenerator:
    """Generate storyboard from screenplay using DeepSeek tool calling."""

    def __init__(self):
        import httpx
        self.model = config.DEEPSEEK_REASONING_MODEL if config.DEEPSEEK_USE_REASONING else config.DEEPSEEK_MODEL
        logger.info("DeepSeek tool-calling mode: model=%s base=%s", self.model, config.DEEPSEEK_BASE_URL)
        http_client = httpx.Client(
            timeout=config.DEEPSEEK_TIMEOUT,
            limits=httpx.Limits(max_keepalive_connections=5),
        )
        self.client = OpenAI(
            api_key=config.DEEPSEEK_API_KEY,
            base_url=config.DEEPSEEK_BASE_URL,
            http_client=http_client,
        )

    # ========================================================================
    # Public API
    # ========================================================================

    def generate(self, script_text: str) -> dict:
        """Run all 4 phases and return combined storyboard dict."""
        ensure_output_dir()  # ensure output root exists
        t0 = time.monotonic()

        # ================================================================
        # Phase 1: Overview (plain chat, no tool)
        # ================================================================
        overview = self._phase1_overview(script_text)
        logger.info("Phase 1 done: %d characters, %d scenes, %d props",
                     len(overview.get("characters", [])),
                     len(overview.get("scenes", [])),
                     len(overview.get("props", [])))

        # ================================================================
        # Phase 2-5: Tool calling for structured output
        # ================================================================
        char_infos = overview.get("characters", [])
        characters: list[dict] = [None] * len(char_infos)
        if char_infos:
            logger.info("Phase 2: defining %d characters (parallel)...", len(char_infos))
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {}
                for i, char_info in enumerate(char_infos):
                    future = executor.submit(
                        self._call_tool,
                        _build_system_filmmaker(),
                        self._build_character_prompt(script_text, char_info, overview),
                        TOOL_DEFINE_CHARACTER,
                        char_info["ref_id"],
                    )
                    futures[future] = (i, char_info)
                for future in as_completed(futures):
                    i, char_info = futures[future]
                    ref_id = char_info["ref_id"]
                    char_detail = future.result()
                    char_detail["scene_appearances"] = char_info.get("scenes", [])
                    characters[i] = char_detail
                    self._save_character_file(char_detail, ensure_output_dir("characters"))
                    logger.info("Phase 2: %s (%s) done", char_info["name"], ref_id)

        # Partial save: characters available
        save_json(self._build_storyboard_index(characters, [], [], []), str(ensure_output_dir() / "storyboard.json"))

        prop_infos = overview.get("props", [])
        props: list[dict] = [None] * len(prop_infos)
        if prop_infos:
            logger.info("Phase 3: defining %d props (parallel)...", len(prop_infos))
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {}
                for i, prop_info in enumerate(prop_infos):
                    future = executor.submit(
                        self._call_tool,
                        _build_system_filmmaker(),
                        self._build_prop_prompt(script_text, prop_info, overview),
                        TOOL_DEFINE_PROP,
                        prop_info["ref_id"],
                    )
                    futures[future] = (i, prop_info)
                for future in as_completed(futures):
                    i, prop_info = futures[future]
                    prop_detail = future.result()
                    prop_detail["scene_appearances"] = _ensure_list(
                        prop_detail.get("scene_appearances") or prop_info.get("scenes", [])
                    )
                    props[i] = prop_detail
                    self._save_prop_file(prop_detail, ensure_output_dir("props"))
                    logger.info("Phase 3: %s (%s) done", prop_info["name"], prop_info["ref_id"])

        # Partial save: characters + props available
        save_json(self._build_storyboard_index(characters, [], props, []), str(ensure_output_dir() / "storyboard.json"))

        scene_infos = overview.get("scenes", [])
        scenes: list[dict] = [None] * len(scene_infos)
        if scene_infos:
            logger.info("Phase 4: defining %d scenes (parallel)...", len(scene_infos))
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {}
                for i, scene_info in enumerate(scene_infos):
                    future = executor.submit(
                        self._call_tool,
                        _build_system_filmmaker(),
                        self._build_scene_prompt(script_text, scene_info, overview),
                        TOOL_DEFINE_SCENE,
                        scene_info["scene_id"],
                    )
                    futures[future] = (i, scene_info)
                for future in as_completed(futures):
                    i, scene_info = futures[future]
                    scene_detail = future.result()
                    scenes[i] = scene_detail
                    self._save_scene_file(scene_detail, ensure_output_dir("scenes"))
                    logger.info("Phase 4: %s (%s) done", scene_info["name"], scene_info["scene_id"])

        # Partial save: characters + scenes + props available
        save_json(self._build_storyboard_index(characters, scenes, props, []), str(ensure_output_dir() / "storyboard.json"))

        all_shots: list[dict] = []
        scene_infos = overview.get("scenes", [])
        if scene_infos:
            logger.info("Phase 5: generating shots for %d scenes (parallel per-scene)...", len(scene_infos))
            # Compute per-scene shot budget from env
            total_shots_env = os.environ.get("TOTAL_SHOTS", "")
            max_per_scene_env = os.environ.get("MAX_SHOTS_PER_SCENE", "")
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {}
                for i, scene_info in enumerate(scene_infos):
                    scene_info = dict(scene_info)  # copy so we don't mutate original
                    # Distribute total shots budget evenly across scenes
                    if total_shots_env:
                        remaining_scenes = len(scene_infos) - i
                        budget = max(1, (int(total_shots_env) - len(all_shots)) // remaining_scenes)
                        scene_info["_shot_budget"] = budget
                    if max_per_scene_env:
                        existing = scene_info.get("_shot_budget", 999)
                        scene_info["_shot_budget"] = min(existing, int(max_per_scene_env))
                    future = executor.submit(
                        self._generate_scene_shots,
                        script_text, scene_info, characters, scenes, props,
                    )
                    futures[future] = scene_info["scene_id"]
                for future in as_completed(futures):
                    scene_shots = future.result()
                    all_shots.extend(scene_shots)
                    save_json(self._build_storyboard_index(characters, scenes, props, all_shots), str(ensure_output_dir() / "storyboard.json"))
                    logger.info("Phase 5: %s done (%d shots)", futures[future], len(scene_shots))
            # Restore original scene order
            scene_order = {s["scene_id"]: i for i, s in enumerate(scene_infos)}
            all_shots.sort(key=lambda s: (scene_order.get(s.get("scene_id", ""), 999), s.get("shot_num", 1)))

        elapsed = time.monotonic() - t0
        total_shots = len(all_shots)
        total_duration = sum(s.get("duration_sec", 0) for s in all_shots)
        logger.info("All phases complete in %.1fs: %d characters, %d scenes, %d props, %d shots (~%.0fs)",
                     elapsed, len(characters), len(scenes), len(props), total_shots, total_duration)

        storyboard = self._build_storyboard_index(characters, scenes, props, all_shots)
        save_json(storyboard, str(ensure_output_dir() / "storyboard.json"))
        return storyboard

    # ========================================================================
    # Phase 1: Overview (plain chat, structured JSON output)
    # ========================================================================

    PHASE1_SYSTEM = """你是一位资深影视剧本分析师。请分析以下剧本，提取角色、场景和叙事关键道具清单。

## 输出格式

请直接输出 JSON（不要用 markdown 代码块包裹），结构如下：

```json
{
  "characters": [
    {
      "ref_id": "安娜",
      "name": "安娜",
      "gender": "男/女",
      "age_range": "年龄段",
      "brief_appearance": "外貌一句话概述，包含关键特征（发型、体型、标志性特征、主要服装风格）。这些特征将在后续环节中用于生成定妆照，所以务必准确具体。",
      "role_type": "主角/配角/龙套",
      "scenes": ["SC_01"]
    }
  ],
  "scenes": [
    {
      "scene_id": "SC_01",
      "name": "场景名",
      "location": "内景/外景",
      "time": "时间（日/夜/具体时段）",
      "brief_summary": "场景一句话概述",
      "characters_present": ["安娜"],
      "emotion_tone": "场景情绪基调"
    }
  ],
  "props": [
    {
      "ref_id": "PROP_01",
      "name": "道具名称",
      "category": "手持物/武器/信物/关键陈设等",
      "brief_description": "一句话外观和状态概述，包含材质、颜色、可辨识特征",
      "narrative_function": "推动剧情、承载线索或需要跨镜头连续性的原因",
      "scenes": ["SC_01"]
    }
  ]
}
```

## 要求

1. brief_appearance 必须包含：发型发色、体型、明显标志特征（痣/伤疤/眼镜等）、主要服装 — 这些都是后续生成定妆照的关键信息
2. 每个角色 ref_id 直接用角色原名（如 "安娜"、"Bob"），不要用 Image1/Image2 之类的编号
3. 每个场景按顺序，用 SC_01, SC_02... 编号
4. scenes 字段列出该角色出场的所有场景编号
5. characters_present 列出该场景出场的所有角色 ref_id
6. props 仅包含剧情关键、被角色持握/操作、需要特写，或需跨镜头保持一致的道具；不要把普通桌椅、墙面、泛化装饰等背景陈设列为道具
7. 道具 ref_id 按出现顺序使用 PROP_01、PROP_02…；scenes 列出其实际出现、被使用或状态发生变化的场景
8. 只输出 JSON，不要任何额外说明文字"""

    def _phase1_overview(self, script_text: str) -> dict:
        """Phase 1: Extract character/scene inventory via plain chat completion."""
        user_prompt = f"请分析以下剧本：\n\n{script_text}"
        response_text = self._call_chat(self.PHASE1_SYSTEM, user_prompt, label="Phase 1")

        result = self._safe_json_parse(response_text, "phase1_overview")
        if result is None:
            logger.error("Phase 1 JSON parse failed. Response (head 500): %s", response_text[:500])
            logger.error("Phase 1 JSON parse failed. Response (tail 500): %s", response_text[-500:])
            raise RuntimeError(
                "Phase 1: failed to extract JSON from model response. "
                f"Raw saved to output/_debug/"
            )

        # Validate required fields
        for char in result.get("characters", []):
            if "ref_id" not in char:
                char["ref_id"] = f"Image{result['characters'].index(char)+1}"

        # Sanitize ref_id: use character name when LLM falls back to ImageN/numbers
            rid = str(char["ref_id"]).strip()
            if rid.lower().startswith("see "):
                rid = rid[4:]
            if not rid or rid.isdigit() or (rid.startswith("Image") and rid[5:].isdigit()):
                name = str(char.get("name", "")).strip()
                if name:
                    rid = name.replace(" ", "_").replace("/", "_")
                else:
                    rid = f"Character{result['characters'].index(char)+1}"
            char["ref_id"] = rid
            char.setdefault("scenes", [])

        for i, scene in enumerate(result.get("scenes", [])):
            if "scene_id" not in scene:
                scene["scene_id"] = f"SC_{i+1:02d}"
            scene.setdefault("characters_present", [])

        for i, prop in enumerate(result.get("props", [])):
            prop.setdefault("ref_id", f"PROP_{i+1:02d}")
            prop["ref_id"] = f"PROP_{i+1:02d}" if not str(prop["ref_id"]).strip() else str(prop["ref_id"]).strip()
            prop.setdefault("name", prop["ref_id"])
            prop.setdefault("scenes", [])

        return result

    # ========================================================================
    # Core API methods: _call_chat (plain) and _call_tool (function calling)
    # ========================================================================

    def _call_chat(self, system_prompt: str, user_prompt: str, label: str = "") -> str:
        """Plain chat completion with streaming feedback. Returns full response text."""
        logger.info("  -> Chat: %s", label)
        logger.debug("  System: %d chars, User: %d chars", len(system_prompt), len(user_prompt))

        t0 = time.monotonic()
        reasoning_parts: list[str] = []
        content_parts: list[str] = []
        chunk_count = 0
        last_log = t0

        stream = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=4096,
            stream=True,
            extra_body={"thinking": {"type": "disabled"}},
        )

        for chunk in stream:
            chunk_count += 1
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta is None:
                continue

            reasoning = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", "") or getattr(delta, "thinking", "")
            if reasoning:
                reasoning_parts.append(reasoning)
                sys.stderr.write(reasoning)
                sys.stderr.flush()

            if delta.content:
                content_parts.append(delta.content)

            now = time.monotonic()
            if now - last_log >= 8.0:
                rc = sum(len(r) for r in reasoning_parts)
                cc = sum(len(c) for c in content_parts)
                logger.info("    ... %d chunks, reasoning=%d chars, content=%d chars, %.0fs ...",
                             chunk_count, rc, cc, now - t0)
                last_log = now

        if reasoning_parts:
            sys.stderr.write("\n")
            sys.stderr.flush()

        elapsed = time.monotonic() - t0
        full = "".join(content_parts)
        logger.info("  <- Chat done in %.1fs: %d chars (%d chunks)", elapsed, len(full), chunk_count)
        return full

    # ========================================================================
    # Prompt builders
    # ========================================================================

    def _build_character_prompt(self, script: str, char_info: dict, overview: dict) -> str:
        name = char_info["name"]
        appearance = char_info.get("brief_appearance", "")
        scenes_list = char_info.get("scenes", [])
        scenes_context = self._describe_scenes_brief(scenes_list, overview)
        return f"""请为角色"{name}"生成完整视觉设定。

角色概要：{appearance}

出场场景：{scenes_context}

原始剧本：
{script[:3000]}

请调用 define_character 工具，为这个角色生成详细设定和定妆照 prompt。"""

    def _build_scene_prompt(self, script: str, scene_info: dict, overview: dict) -> str:
        name = scene_info["name"]
        sid = scene_info["scene_id"]
        chars = scene_info.get("characters_present", [])
        return f"""请为场景"{name}"（{sid}）生成完整的空间、光线、色彩设定。

场景概要：{scene_info.get('brief_summary', '')}
地点：{scene_info.get('location', '')}，时间：{scene_info.get('time', '')}
情绪基调：{scene_info.get('emotion_tone', '')}
出场角色：{', '.join(chars)}

原始剧本：
{script[:3000]}

请调用 define_scene 工具。"""

    def _build_prop_prompt(self, script: str, prop_info: dict, overview: dict) -> str:
        name = prop_info["name"]
        ref_id = prop_info["ref_id"]
        scenes_context = self._describe_scenes_brief(prop_info.get("scenes", []), overview)
        return f"""请为叙事关键道具“{name}”（{ref_id}）生成完整且可跨镜头复用的设定。

道具概要：{prop_info.get('brief_description', '')}
叙事功能：{prop_info.get('narrative_function', '')}
出现/使用场景：{scenes_context}

原始剧本：
{script[:3000]}

请调用 define_prop 工具。必须锁定道具的材质、颜色、尺寸比例、可辨识特征、磨损状态与持握/摆放方式；若剧本让道具发生状态变化，请明确说明变化发生前后各自的状态。"""

    def _build_shot_prompt(
        self, script: str, scene_info: dict, chars_in_scene: list[str],
        characters: list[dict], scenes: list[dict], props: list[dict],
        shot_num: int, prev_shot: dict | None,
    ) -> str:
        sid = scene_info["scene_id"]
        name = scene_info["name"]

        # Find character details for chars in this scene
        char_details = []
        for ref_id in chars_in_scene:
            for c in characters:
                if c.get("ref_id") == ref_id:
                    char_details.append(f"  {ref_id} ({c.get('name', '')})：{c.get('face', '')} {c.get('hair', '')} 服装：{c.get('clothing', '')}")
                    break

        # Find scene detail
        scene_detail = ""
        for s in scenes:
            if s.get("scene_id") == sid:
                scene_detail = f"空间：{s.get('spatial_description', '')}\n光线：{s.get('lighting_primary', '')}"
                break

        prop_details = []
        active_prop_ids = _ensure_list(scene_info.get("props_present", []))
        for prop in props:
            if prop.get("ref_id") in active_prop_ids or sid in _ensure_list(prop.get("scene_appearances", [])):
                prop_details.append(
                    f"  {prop.get('ref_id')}（{prop.get('name', '')}）：{prop.get('visual_description', '')}；"
                    f"材质/状态：{prop.get('material_and_condition', '')}；连续性：{prop.get('continuity_rules', '')}"
                )

        # Previous shot context for continuity
        prev_context = ""
        if prev_shot:
            prev_context = f"""上一镜（第{shot_num - 1}镜）信息：
  景别：{prev_shot.get('shot_size', '')}
  机位：{prev_shot.get('camera_position', '')}
  主体：{prev_shot.get('visual_subject', '')}
  位置/朝向：{prev_shot.get('spatial_position', '')}
  下一镜预留：{prev_shot.get('spatial_continuity_next', '')}
"""
        else:
            prev_context = "这是该场景的第 1 个镜头（起始镜）。"

        # User constraints from env vars
        max_per_scene = os.environ.get("MAX_SHOTS_PER_SCENE", "")
        total_shots_limit = os.environ.get("TOTAL_SHOTS", "")
        total_dur = os.environ.get("TOTAL_DURATION", "")
        constraints = ""
        if max_per_scene:
            constraints += f"\n注意：本场景最多 {max_per_scene} 个镜头，已生成 {shot_num - 1} 镜。"
        if total_shots_limit:
            constraints += f"\n注意：全片总镜头数上限 {total_shots_limit} 镜。"
        if total_dur:
            constraints += f"\n注意：全片目标总时长约 {total_dur} 秒，请据此控制每个镜头的 duration_sec（单镜头不超过 10 秒）。"

        return f"""场景"{name}"（{sid}）的第 {shot_num} 镜。{constraints}

场景空间与光线：
{scene_detail}

出场角色及其外貌：
{chr(10).join(char_details) if char_details else '（空镜，无角色）'}

本场景可能出现的关键道具：
{chr(10).join(prop_details) if prop_details else '（无关键道具）'}

场景情绪基调：{scene_info.get('emotion_tone', '')}

{prev_context}

原始剧本（仅该场景部分）：
{script[:4000]}

请调用 create_scene_shot 工具，只生成第 {shot_num} 镜。
判断 is_scene_end：如果这是本场景最后一个镜头（叙事/情绪/动作已完成），设为 true；否则设为 false。
严格遵守 180 度规则和相邻镜头空间/光线连续性。
只有道具实际可见、被持握或被操作时，才把其 ref_id 写入 prop_refs；并在画面描述、动作与视频 prompt 中准确体现其当前状态。
注意：duration_sec 是单镜头时长，不能超过 10 秒；总时长 = 所有镜头 duration_sec 之和。不要被剧本中的"总长度"描述误导——那是整部影片的时长，不是单个镜头的时长。"""

    def _describe_scenes_brief(self, scene_labels: list[str], overview: dict) -> str:
        """Build a brief description of scenes a character appears in."""
        if not scene_labels:
            return "（全剧出场）"
        scenes = overview.get("scenes", [])
        parts = []
        for label in scene_labels:
            for s in scenes:
                if s.get("scene_id") == label:
                    parts.append(f"{label}（{s.get('name', '')}）：{s.get('brief_summary', '')}")
                    break
        return "；".join(parts) if parts else "（信息不足）"

    # ========================================================================
    # Core tool-calling method
    # ========================================================================

    def _call_tool(self, system_prompt: str, user_prompt: str, tool_def: dict, debug_tag: str = "") -> dict:
        """Make a tool-calling API request with streaming feedback, return parsed JSON."""
        tool_name = tool_def["function"]["name"]
        tag = f" [{debug_tag}]" if debug_tag else ""
        logger.info("  -> %s%s", tool_name, tag)
        logger.debug("  System: %d chars, User: %d chars", len(system_prompt), len(user_prompt))

        t0 = time.monotonic()
        try:
            stream = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                tools=[tool_def],
                temperature=0.7,
                max_tokens=16384,
                stream=True,
                extra_body={"thinking": {"type": "disabled"}},
            )
        except Exception:
            logger.error("  API call failed to start", exc_info=True)
            raise

        # Collect streaming chunks: reasoning to stderr, tool arguments silently
        reasoning_parts: list[str] = []
        content_parts: list[str] = []
        arguments_parts: list[str] = []
        chunk_count = 0
        last_log = t0

        for chunk in stream:
            chunk_count += 1
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta is None:
                continue

            # Reasoning (real-time to stderr)
            reasoning = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", "") or getattr(delta, "thinking", "")
            if reasoning:
                reasoning_parts.append(reasoning)
                sys.stderr.write(reasoning)
                sys.stderr.flush()

            # Content text
            if delta.content:
                content_parts.append(delta.content)

            # Tool call arguments
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    if tc.function and tc.function.arguments:
                        arguments_parts.append(tc.function.arguments)

            # Progress every 8s
            now = time.monotonic()
            if now - last_log >= 8.0:
                rc = sum(len(r) for r in reasoning_parts)
                ac = sum(len(a) for a in arguments_parts)
                logger.info("  ... %s: %.0fs, %d chunks, args=%d chars%s",
                             debug_tag or tool_name, now - t0, chunk_count, ac,
                             f", reasoning={rc} chars" if rc else "")
                last_log = now

        if reasoning_parts:
            sys.stderr.write("\n")
            sys.stderr.flush()

        elapsed = time.monotonic() - t0
        tool_args = "".join(arguments_parts)

        logger.info("  <- %s done in %.1fs: args=%d chars (%d chunks)%s",
                     tool_name, elapsed, len(tool_args), chunk_count, tag)

        if not tool_args:
            logger.error("  No tool arguments received! Content: %s", "".join(content_parts)[:500])
            raise RuntimeError(f"Tool {tool_def['function']['name']} returned no arguments")

        # Save raw args for debugging
        from pathlib import Path
        debug_dir = ensure_output_dir("_debug")
        tag = f"_{debug_tag}" if debug_tag else ""
        debug_file = debug_dir / f"{tool_def['function']['name']}{tag}_raw_args.json"
        try:
            debug_file.write_text(json.dumps(json.loads(tool_args), indent=2, ensure_ascii=False), encoding="utf-8")
        except json.JSONDecodeError:
            debug_file.write_text(tool_args, encoding="utf-8")
        logger.debug("  Raw args saved to %s", debug_file)

        result = self._safe_json_parse(tool_args, tool_def["function"]["name"])
        if result is None:
            logger.error("  Tool args (head 300): %s", tool_args[:300])
            logger.error("  Tool args (tail 300): %s", tool_args[-300:])
            raise RuntimeError(
                f"Failed to parse JSON from {tool_def['function']['name']}. "
                f"Raw saved to {debug_file}"
            )
        return result

    @staticmethod
    def _safe_json_parse(text: str, tool_name: str = "") -> dict | None:
        """Multi-strategy JSON recovery for tool call arguments."""
        strategies = [
            # 1. Direct parse
            lambda t: json.loads(t),
            # 2. Extract outermost {...} with DOTALL
            lambda t: json.loads(re.search(r'\{.*\}', t, re.S).group(0)),
            # 3. Try to fix truncation: close unclosed braces/brackets
            lambda t: StoryboardGenerator._fix_truncated_json(t),
            # 4. Remove any markdown code fences
            lambda t: json.loads(re.sub(r'```(?:json)?\s*|\s*```', '', t).strip()),
            # 5. Find first { to last }
            lambda t: json.loads(t[t.find('{'):t.rfind('}')+1]),
        ]

        for i, strategy in enumerate(strategies):
            try:
                result = strategy(text)
                if isinstance(result, dict):
                    logger.debug("  JSON parse strategy %d succeeded", i + 1)
                    return result
            except (json.JSONDecodeError, AttributeError, IndexError):
                continue

        return None

    @staticmethod
    def _fix_truncated_json(text: str) -> dict:
        """Attempt to repair truncated JSON by counting braces/brackets."""
        # Count unclosed braces
        open_braces = text.count('{') - text.count('}')
        open_brackets = text.count('[') - text.count(']')
        # Check if we're inside a string
        in_string = False
        for i, ch in enumerate(text):
            if ch == '"' and (i == 0 or text[i-1] != '\\'):
                in_string = not in_string
        if in_string:
            text = text + '"'
        # Close any open structures
        text = text + ']' * open_brackets + '}' * open_braces
        return json.loads(text)

    # ========================================================================
    # Storyboard Index
    # ========================================================================

    def _generate_scene_shots(self, script_text: str, scene_info: dict,
                                characters: list[dict], scenes: list[dict], props: list[dict]) -> list[dict]:
        """Generate all shots for one scene (sequential within scene)."""
        scene_id = scene_info["scene_id"]
        chars_in_scene = scene_info.get("characters_present", [])
        scene_shots: list[dict] = []
        shot_num = 1
        prev_shot: dict | None = None
        shot_budget = scene_info.get("_shot_budget", 0)
        while True:
            # Stop if we've hit the per-scene budget
            if shot_budget > 0 and shot_num > shot_budget:
                logger.info("Scene %s: hit shot budget (%d), forcing end", scene_id, shot_budget)
                if scene_shots:
                    scene_shots[-1]["is_scene_end"] = True
                break
            shot_detail = self._call_tool(
                _build_system_filmmaker(),
                self._build_shot_prompt(script_text, scene_info, chars_in_scene,
                                         characters, scenes, props, shot_num, prev_shot),
                TOOL_CREATE_SHOT,
                f"{scene_id}_SHOT{shot_num:02d}",
            )
            shot_id = f"{scene_id}_SHOT{shot_num:02d}"
            shot_detail["full_shot_id"] = shot_id
            shot_detail["scene_id"] = scene_id
            shot_detail["shot_num"] = shot_num
            shot_detail["md_file"] = f"shots/{shot_id}/{shot_id}.md"
            shot_detail["startframe_file"] = f"shots/{shot_id}/{shot_id}_startframe.jpg"
            shot_detail["video_file"] = f"shots/{shot_id}/{shot_id}.mp4"
            scene_shots.append(shot_detail)
            shot_dir = ensure_output_dir("shots", shot_id)
            self._save_shot_files(shot_detail, shot_dir)
            self._save_shot_deps(shot_detail, shot_dir, characters, scenes, props)
            if shot_detail.get("is_scene_end", False):
                logger.info("Scene %s complete: %d shots", scene_id, shot_num)
                break
            prev_shot = shot_detail
            shot_num += 1
        return scene_shots

    @staticmethod
    def _build_storyboard_index(
        characters: list[dict], scenes: list[dict], props: list[dict], all_shots: list[dict],
    ) -> dict:
        """Build a structural index with only non-derivable fields.

        - ref_id / scene_id: authoritative list of entities (derivable from
          filesystem but storyboard.json is the canonical index).
        - full_shot_id: shot identity.
        - duration_sec: not derivable from any other file.
        - transition_type: not derivable from any other file.

        Everything else (names, prompts, character/prop refs, scene_id per
        shot, shot_num) is in .md or deps.json or derivable by parsing the ID.
        """
        return {
            "characters": [{"ref_id": c["ref_id"], "name": c.get("name", c["ref_id"])} for c in characters],
            "scenes": [{"scene_id": s["scene_id"]} for s in scenes],
            "props": [
                {
                    "ref_id": p["ref_id"],
                    "name": p.get("name", p["ref_id"]),
                    "category": p.get("category", ""),
                    "narrative_function": p.get("narrative_function", ""),
                }
                for p in props
            ],
            "shots": [
                {
                    "full_shot_id": s["full_shot_id"],
                    "duration_sec": s.get("duration_sec", 5),
                    "transition_type": s.get("transition_type", "B"),
                    "shot_size": s.get("shot_size", ""),
                    "action_description": s.get("action_description", ""),
                    "positive_prompt": s.get("positive_prompt", ""),
                    "dialogue_line": s.get("dialogue_line", ""),
                    "start_frame_prompt": s.get("start_frame_prompt", ""),
                    "startframe_file": s.get("startframe_file", ""),
                }
                for s in all_shots
            ],
        }

    # ========================================================================
    # File output
    # ========================================================================

    def _save_character_file(self, char: dict, out_dir) -> None:
        ref_id = char.get("ref_id", "UNKNOWN")
        name = char.get("name", ref_id)
        lines = [
            f"# {ref_id} | {name}",
            "",
            f"## 基本信息",
            f"- 姓名：{name}",
            f"- 性别：{char.get('gender', '')}",
            f"- 年龄：{char.get('age', '')}",
            f"- 身高体型：{char.get('height_build', '')}",
            "",
            f"## 外貌",
            f"- 面部：{char.get('face', '')}",
            f"- 发型：{char.get('hair', '')}",
            f"- 标志特征：{char.get('distinctive_features', '')}",
            "",
            f"## 服装",
            f"{char.get('clothing', '')}",
            "",
            f"## 声音与性格",
            f"- 声音：{char.get('voice_quality', '')}",
            f"- 性格：{char.get('personality', '')}",
            "",
            f"## 出场场景",
            f"{', '.join(char.get('scene_appearances', []))}",
            "",
            f"## 定妆照 Prompt — 正面胸像",
            f"```",
            f"{char.get('portrait_front_prompt', '')}",
            f"```",
            "",
            f"## 定妆照 Prompt — 45°侧面",
            f"```",
            f"{char.get('portrait_profile_prompt', '')}",
            f"```",
            "",
            f"## 定妆照 Prompt — 全身",
            f"```",
            f"{char.get('fullbody_prompt', '')}",
            f"```",
            "",
        ]
        (out_dir / f"{ref_id}.md").write_text("\n".join(lines), encoding="utf-8")

    def _save_scene_file(self, scene: dict, out_dir) -> None:
        sid = scene.get("scene_id", "UNKNOWN")
        name = scene.get("name", sid)
        lines = [
            f"# {sid} | {name}",
            "",
            f"## 基本信息",
            f"- 类型：{scene.get('location_type', '')}",
            f"- 时间：{scene.get('time_period', '')}",
            "",
            f"## 空间",
            f"{scene.get('spatial_description', '')}",
            "",
            f"## 光影",
            f"- 主光：{scene.get('lighting_primary', '')}",
            f"- 辅光：{scene.get('lighting_fill', '')}",
            f"- 光比：{scene.get('lighting_ratio', '')}",
            "",
            f"## 色彩",
            f"- 主导色：{scene.get('color_dominant', '')}",
            f"- 点缀色：{scene.get('color_accent', '')}",
            f"- 质感参照：{scene.get('visual_reference', '')}",
            "",
            f"## 环境音",
            f"{scene.get('ambience_sound', '')}",
            "",
            f"## 场景参考图 Prompt — 广角",
            f"```",
            f"{scene.get('scene_wide_prompt', '')}",
            f"```",
            "",
            f"## 场景参考图 Prompt — 细节特写",
            f"```",
            f"{scene.get('scene_detail_prompt', '')}",
            f"```",
            "",
        ]
        (out_dir / f"{sid}.md").write_text("\n".join(lines), encoding="utf-8")

    def _save_prop_file(self, prop: dict, out_dir) -> None:
        """Save a human-editable continuity card for one key prop."""
        ref_id = prop.get("ref_id", "UNKNOWN")
        name = prop.get("name", ref_id)
        lines = [
            f"# {ref_id} | {name}",
            "",
            "## 基本信息",
            f"- 名称：{name}",
            f"- 类别：{prop.get('category', '')}",
            f"- 叙事功能：{prop.get('narrative_function', '')}",
            "",
            "## 视觉定义",
            f"- 外观：{prop.get('visual_description', '')}",
            f"- 材质与状态：{prop.get('material_and_condition', '')}",
            f"- 尺寸与比例：{prop.get('dimensions', '')}",
            f"- 色彩：{prop.get('color_palette', '')}",
            f"- 识别特征：{prop.get('distinctive_features', '')}",
            "",
            "## 使用与连续性",
            f"- 持握/摆放：{prop.get('handling_notes', '')}",
            f"- 连续性规则：{prop.get('continuity_rules', '')}",
            f"- 出现场景：{', '.join(_ensure_list(prop.get('scene_appearances', [])))}",
            "",
            "## 道具参考图 Prompt",
            "```",
            prop.get("reference_prompt", ""),
            "```",
            "",
        ]
        (out_dir / f"{ref_id}.md").write_text("\n".join(lines), encoding="utf-8")

    def _save_shot_files(self, shot: dict, out_dir) -> None:
        """Save one .md file per shot with start frame prompt + full shot breakdown."""
        shot_id = shot.get("full_shot_id", f"SHOT{shot.get('shot_num', '?')}")
        lines = [
            f"# {shot_id}",
            "",
            f"| 字段 | 值 |",
            f"|------|----|",
        ]
        # Only include rows with non-empty values
        table_rows = [
            ("场景", shot.get("scene_id", "")),
            ("时长", f"{shot.get('duration_sec', '')}s" if shot.get('duration_sec') else ""),
            ("衔接", shot.get("transition_type", "")),
            ("景别", shot.get("shot_size", "")),
            ("机位", shot.get("camera_position", "")),
            ("运镜", shot.get("camera_movement", "")),
            ("角色", ', '.join(_ensure_list(shot.get("character_refs", [])))),
            ("道具", ', '.join(_ensure_list(shot.get("prop_refs", [])))),
        ]
        for label, value in table_rows:
            if value.strip():
                lines.append(f"| {label} | {value} |")
        lines.append("")
        lines.append("## 画面内容")
        lines.append(f"- 前景：{shot.get('visual_foreground', '')}")
        lines.append(f"- 主体：{shot.get('visual_subject', '')}")
        lines.append(f"- 背景：{shot.get('visual_background', '')}")
        lines.append(f"- 细节：{shot.get('visual_details', '')}")
        lines.append("")
        lines.append("## 动作")
        lines.append("")
        for seg in (shot.get('action_description', '') or '（无）').strip().split('\n'):
            seg = seg.strip()
            if seg:
                lines.append(f"- {seg}")
        lines.append("")
        lines.append("## 光影")
        lines.append(f"- 主光：{shot.get('lighting_key', '')}")
        lines.append(f"- 辅光：{shot.get('lighting_fill', '')}")
        lines.append(f"- 光比：{shot.get('lighting_ratio', '')}")
        lines.append(f"- 氛围：{shot.get('lighting_mood', '')}")
        lines.append("")
        lines.append("## 色彩")
        lines.append(f"- 主导：{shot.get('color_dominant', '')}")
        lines.append(f"- 点缀：{shot.get('color_accent', '')}")
        lines.append(f"- 参照：{shot.get('color_reference', '')}")
        lines.append("")
        lines.append("## 构图与空间")
        lines.append(f"- 纵深：{shot.get('composition_depth', '')}")
        lines.append(f"- 锚点：{shot.get('composition_anchor', '')}")
        lines.append(f"- 方向：{shot.get('composition_direction', '')}")
        lines.append(f"- 位置：{shot.get('spatial_position', '')}")
        lines.append(f"- 前镜衔接：{shot.get('spatial_continuity_prev', '')}")
        lines.append(f"- 后镜预留：{shot.get('spatial_continuity_next', '')}")
        lines.append("")
        lines.append("## 音频")
        lines.append(f"- 对白：{shot.get('dialogue_line', '') or '（无）'}")
        lines.append(f"- 音效：{shot.get('sfx_marks', '') or '（无）'}")
        lines.append("")
        lines.append("## 视频 Prompt（正面）")
        lines.append("```")
        lines.append(shot.get('positive_prompt', ''))
        lines.append("```")
        lines.append("")
        lines.append("## 视频 Prompt（负面）")
        lines.append("```")
        lines.append(shot.get('negative_prompt', ''))
        lines.append("```")
        lines.append("")
        (out_dir / f"{shot_id}.md").write_text("\n".join(lines), encoding="utf-8")

        # Separate start frame prompt file (model data for Step 2)
        sf_prompt = shot.get("start_frame_prompt", "")
        if sf_prompt:
            (out_dir / f"{shot_id}_startframe.md").write_text(sf_prompt, encoding="utf-8")

    @staticmethod
    def _save_shot_deps(
        shot: dict, out_dir, characters: list[dict], scenes: list[dict], props: list[dict],
    ) -> None:
        """Save program-readable dependency references (IDs only, not prompts)."""
        deps = {
            "character_refs": _ensure_list(shot.get("character_refs", [])),
            "character_md_files": [
                f"characters/{c.get('ref_id')}.md"
                for c in characters if c.get("ref_id") in _ensure_list(shot.get("character_refs", []))
            ],
            "scene_id": shot.get("scene_id", ""),
            "scene_md_file": f"scenes/{shot.get('scene_id', '')}.md",
            "prop_refs": _ensure_list(shot.get("prop_refs", [])),
            "prop_md_files": [
                f"props/{p.get('ref_id')}.md"
                for p in props if p.get("ref_id") in _ensure_list(shot.get("prop_refs", []))
            ],
            "startframe_md_file": f"shots/{shot.get('full_shot_id', '')}/{shot.get('full_shot_id', '')}_startframe.md",
        }
        save_json(deps, str(out_dir / "deps.json"))


# ========================================================================
# Convenience function
# ========================================================================

def generate_storyboard(script_path: str) -> dict:
    from src.utils import load_script
    script_text = load_script(script_path)
    generator = StoryboardGenerator()
    return generator.generate(script_text)
