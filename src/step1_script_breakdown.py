"""
Step 1: Script parsing and storyboard generation via DeepSeek (Tool Calling).

Four phases, each producing structured JSON via function calling:
  Phase 1 — extract_script_overview  (1 call)  → character list + scene list
  Phase 2 — define_character          (N calls) → per-character portrait + prompts
  Phase 3 — define_scene              (M calls) → per-scene reference + prompts
  Phase 4 — create_scene_shot         (N calls) → one call per shot, per-shot prompts

Each tool call's output is saved directly as an individual file.
"""

import asyncio
import json
import logging
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from openai import OpenAI

from config import config
from src.utils import ensure_output_dir, save_json

logger = logging.getLogger("step1")

# ============================================================================
# Film grammar knowledge (shared across all phases)
# ============================================================================

FILM_GRAMMAR = """
## 景别（Shot Size）
ELS（极远景）WS（全景）FS（中全景）MS（中景）MCU（中近景）CU（特写）ECU（大特写）
原则：对话以MS/MCU为主穿插CU；情绪高潮用CU/ECU；建立场景用WS/FS；同一场景内避免连续3个相同景别。

## 机位与角度
眼平（自然）、低角度（压迫/威胁）、高角度（脆弱）、过肩（对话）、俯拍（抽离）、荷兰角（不安）。

## 运镜
固定、缓推（增强情感）、缓拉（揭示语境）、跟拍、手持（真实感/紧张）、摇镜。

## 180度规则
对话场景中所有机位必须在角色轴线同一侧，标注屏幕方向和视线方向。

## 光线
定义主光方向/类型/色温、辅光、光比（2:1亮调/喜剧，3:1正常，4:1+暗调/惊悚）。

## 色彩
主导色+情感关联（暖=亲密/怀旧，冷=疏离/压抑），饱和度，质感参照。

## 构图
三分法、纵深层次（前景/中景/背景）、视线引导、负空间。

## 衔接类型
A类（连续动作，需起止帧对齐）、B类（视角切换，同一时空）、C类（时间跳跃）、D类（场景切换）。
"""

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
                "portrait_front_prompt": {"type": "string", "description": "正面胸像定妆照英文 prompt，含 studio lighting / 85mm / photorealistic / 8K"},
                "portrait_profile_prompt": {"type": "string", "description": "45°侧面胸像英文 prompt"},
                "fullbody_prompt": {"type": "string", "description": "全身站立照英文 prompt，含完整服装"},
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
                "scene_wide_prompt": {"type": "string", "description": "场景主视角广角图英文 prompt，无人，16:9，photorealistic，8K"},
                "scene_detail_prompt": {"type": "string", "description": "场景关键元素特写英文 prompt"},
            },
            "required": ["scene_id", "name", "spatial_description", "lighting_primary", "color_dominant", "scene_wide_prompt"],
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
                "duration_sec": {"type": "number", "description": "时长（秒）"},
                "transition_type": {"type": "string", "enum": ["A", "B", "C", "D", "起始镜"], "description": "衔接类型"},
                "shot_size": {"type": "string", "description": "景别"},
                "camera_position": {"type": "string", "description": "机位描述"},
                "camera_movement": {"type": "string", "description": "运镜描述"},
                "action_description": {"type": "string", "description": "镜头内的完整动作流程，按时间顺序：0-N秒发生了什么、角色如何移动、肢体动作、表情变化、关键时间点。这是视频模型最核心的输入——视频是运动媒介，没有清晰的运动描述就得不到有意义的视频。每个镜头至少写3句动作描述。"},
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
                "positive_prompt": {"type": "string", "description": "视频生成正面 prompt，详细到景别/运镜/角色(Image引用)/动作/光影/色彩/质感/画幅"},
                "negative_prompt": {"type": "string", "description": "视频生成负面 prompt"},
                "start_frame_prompt": {"type": "string", "description": "起始帧图片 prompt，用于文生图模型生成该镜头的第一帧静止图片。与 positive_prompt 的唯一区别：(1) 16:9 画幅 (2) 去掉所有运镜/运动描述——只描述一个静止瞬间。"},
            },
            "required": ["scene_id", "shot_num", "is_scene_end", "duration_sec", "transition_type", "shot_size", "action_description", "visual_subject", "positive_prompt", "negative_prompt", "start_frame_prompt"],
        },
    },
}

# ============================================================================
# System prompts for each phase
# ============================================================================

SYSTEM_FILMMAKER = f"""你是一位资深电影导演和分镜师，精通视觉叙事和 AI 视频生成（Seedance 2.0）。

## 你的电影知识体系
{FILM_GRAMMAR}

## 核心原则

### 视频 prompt（positive_prompt / negative_prompt）
1. 动作描述是视频 prompt 的核心——视频是运动媒介，没有运动就没有视频。必须详细描述镜头内每一段时间内的动作：角色如何移动、做什么、肢体和表情如何变化
2. 具体视觉细节，不要抽象情绪词
3. 视频 prompt 中引用角色时用 "see ImageN for reference" 格式（N 为角色 ref_id），注意 ref_id 本身不含 "see " 前缀
4. 包含景别/运镜描述
5. 光影/色彩/质感描述作为辅助，但不应占据超过 prompt 30% 的篇幅

### 起始帧 prompt（start_frame_prompt）
1. 与 positive_prompt 的唯一区别：去掉运镜/运动描述，只描述静止瞬间
2. 16:9 画幅

### 通用
6. 相邻镜头的光线、色彩、空间关系必须自洽
7. 对话场景严格遵守 180 度规则"""


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
        logger.info("Phase 1 done: %d characters, %d scenes",
                     len(overview.get("characters", [])),
                     len(overview.get("scenes", [])))

        # ================================================================
        # Phase 2-4: Tool calling for structured output
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
                        SYSTEM_FILMMAKER,
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

        scene_infos = overview.get("scenes", [])
        scenes: list[dict] = [None] * len(scene_infos)
        if scene_infos:
            logger.info("Phase 3: defining %d scenes (parallel)...", len(scene_infos))
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {}
                for i, scene_info in enumerate(scene_infos):
                    future = executor.submit(
                        self._call_tool,
                        SYSTEM_FILMMAKER,
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
                    logger.info("Phase 3: %s (%s) done", scene_info["name"], scene_info["scene_id"])

        all_shots: list[dict] = []
        scene_infos = overview.get("scenes", [])
        if scene_infos:
            logger.info("Phase 4: generating shots for %d scenes (parallel per-scene)...", len(scene_infos))
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = {}
                for scene_info in scene_infos:
                    future = executor.submit(
                        self._generate_scene_shots,
                        script_text, scene_info, characters, scenes,
                    )
                    futures[future] = scene_info["scene_id"]
                for future in as_completed(futures):
                    scene_shots = future.result()
                    all_shots.extend(scene_shots)
                    logger.info("Phase 4: %s done (%d shots)", futures[future], len(scene_shots))
            # Restore original scene order
            scene_order = {s["scene_id"]: i for i, s in enumerate(scene_infos)}
            all_shots.sort(key=lambda s: (scene_order.get(s.get("scene_id", ""), 999), s.get("shot_num", 1)))

        elapsed = time.monotonic() - t0
        total_shots = len(all_shots)
        total_duration = sum(s.get("duration_sec", 0) for s in all_shots)
        logger.info("All phases complete in %.1fs: %d characters, %d scenes, %d shots (~%.0fs)",
                     elapsed, len(characters), len(scenes), total_shots, total_duration)

        storyboard = self._build_storyboard_index(characters, scenes, all_shots)
        save_json(storyboard, str(ensure_output_dir() / "storyboard.json"))
        return storyboard

    # ========================================================================
    # Phase 1: Overview (plain chat, structured JSON output)
    # ========================================================================

    PHASE1_SYSTEM = """你是一位资深影视剧本分析师。请分析以下剧本，提取角色清单和场景清单。

## 输出格式

请直接输出 JSON（不要用 markdown 代码块包裹），结构如下：

```json
{
  "characters": [
    {
      "ref_id": "Image1",
      "name": "角色名",
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
      "characters_present": ["Image1", "Image2"],
      "emotion_tone": "场景情绪基调"
    }
  ]
}
```

## 要求

1. brief_appearance 必须包含：发型发色、体型、明显标志特征（痣/伤疤/眼镜等）、主要服装 — 这些都是后续生成定妆照的关键信息
2. 每个角色按出场顺序，ref_id 固定为 Image1, Image2...（就是 "Image" + 数字，不含 "see " 或其他前缀）
3. 每个场景按顺序，用 SC_01, SC_02... 编号
4. scenes 字段列出该角色出场的所有场景编号
5. characters_present 列出该场景出场的所有角色 ref_id
6. 只输出 JSON，不要任何额外说明文字"""

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
            # Sanitize: strip "see " prefix and replace spaces with underscores
            rid = str(char["ref_id"]).strip()
            if rid.lower().startswith("see "):
                rid = rid[4:]
            rid = rid.replace(" ", "_")
            char["ref_id"] = rid
            char.setdefault("scenes", [])

        for i, scene in enumerate(result.get("scenes", [])):
            if "scene_id" not in scene:
                scene["scene_id"] = f"SC_{i+1:02d}"
            scene.setdefault("characters_present", [])

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

    def _build_shot_prompt(
        self, script: str, scene_info: dict, chars_in_scene: list[str],
        characters: list[dict], scenes: list[dict],
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

        return f"""场景"{name}"（{sid}）的第 {shot_num} 镜。

场景空间与光线：
{scene_detail}

出场角色及其外貌：
{chr(10).join(char_details) if char_details else '（空镜，无角色）'}

场景情绪基调：{scene_info.get('emotion_tone', '')}

{prev_context}

原始剧本（仅该场景部分）：
{script[:4000]}

请调用 create_scene_shot 工具，只生成第 {shot_num} 镜。
判断 is_scene_end：如果这是本场景最后一个镜头（叙事/情绪/动作已完成），设为 true；否则设为 false。
严格遵守 180 度规则和相邻镜头空间/光线连续性。
注意：start_frame_prompt 与 positive_prompt 的唯一区别——去掉运镜描述、16:9 画幅。"""

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
        logger.info("  -> Calling tool: %s", tool_def["function"]["name"])
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
                logger.info("    ... %d chunks, reasoning=%d chars, args=%d chars, %.0fs ...",
                             chunk_count, rc, ac, now - t0)
                last_log = now

        if reasoning_parts:
            sys.stderr.write("\n")
            sys.stderr.flush()

        elapsed = time.monotonic() - t0
        tool_args = "".join(arguments_parts)

        logger.info("  <- %s done in %.1fs: args=%d chars (%d chunks)",
                     tool_def["function"]["name"], elapsed, len(tool_args), chunk_count)

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
                                characters: list[dict], scenes: list[dict]) -> list[dict]:
        """Generate all shots for one scene (sequential within scene)."""
        scene_id = scene_info["scene_id"]
        chars_in_scene = scene_info.get("characters_present", [])
        scene_shots: list[dict] = []
        shot_num = 1
        prev_shot: dict | None = None
        while True:
            shot_detail = self._call_tool(
                SYSTEM_FILMMAKER,
                self._build_shot_prompt(script_text, scene_info, chars_in_scene,
                                         characters, scenes, shot_num, prev_shot),
                TOOL_CREATE_SHOT,
                f"{scene_id}_SHOT{shot_num:02d}",
            )
            shot_id = f"{scene_id}_SHOT{shot_num:02d}"
            shot_detail["full_shot_id"] = shot_id
            shot_detail["scene_id"] = scene_id
            shot_detail["shot_num"] = shot_num
            shot_detail["md_file"] = f"shots/{shot_id}/{shot_id}.md"
            shot_detail["startframe_file"] = f"shots/{shot_id}/{shot_id}_startframe.png"
            shot_detail["video_file"] = f"shots/{shot_id}/{shot_id}.mp4"
            scene_shots.append(shot_detail)
            shot_dir = ensure_output_dir("shots", shot_id)
            self._save_shot_files(shot_detail, shot_dir)
            self._save_shot_deps(shot_detail, shot_dir, characters, scenes)
            if shot_detail.get("is_scene_end", False):
                logger.info("Scene %s complete: %d shots", scene_id, shot_num)
                break
            prev_shot = shot_detail
            shot_num += 1
        return scene_shots

    @staticmethod
    def _build_storyboard_index(
        characters: list[dict], scenes: list[dict], all_shots: list[dict],
    ) -> dict:
        """Build a structural index with only non-derivable fields.

        - ref_id / scene_id: authoritative list of entities (derivable from
          filesystem but storyboard.json is the canonical index).
        - full_shot_id: shot identity.
        - duration_sec: not derivable from any other file.
        - transition_type: not derivable from any other file.

        Everything else (names, prompts, character_refs, scene_id per shot,
        shot_num) is in .md or deps.json or derivable by parsing the ID.
        """
        return {
            "characters": [{"ref_id": c["ref_id"]} for c in characters],
            "scenes": [{"scene_id": s["scene_id"]} for s in scenes],
            "shots": [
                {
                    "full_shot_id": s["full_shot_id"],
                    "duration_sec": s.get("duration_sec", 5),
                    "transition_type": s.get("transition_type", "B"),
                    "shot_size": s.get("shot_size", ""),
                    "action_description": s.get("action_description", ""),
                    "positive_prompt": s.get("positive_prompt", ""),
                    "dialogue_line": s.get("dialogue_line", ""),
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

    def _save_shot_files(self, shot: dict, out_dir) -> None:
        """Save one .md file per shot with start frame prompt + full shot breakdown."""
        shot_id = shot.get("full_shot_id", f"SHOT{shot.get('shot_num', '?')}")
        lines = [
            f"# {shot_id}",
            "",
            f"| 字段 | 值 |",
            f"|------|----|",
            f"| 场景 | {shot.get('scene_id', '')} |",
            f"| 时长 | {shot.get('duration_sec', '')}s |",
            f"| 衔接 | {shot.get('transition_type', '')} |",
            f"| 景别 | {shot.get('shot_size', '')} |",
            f"| 机位 | {shot.get('camera_position', '')} |",
            f"| 运镜 | {shot.get('camera_movement', '')} |",
            f"| 角色 | {', '.join(shot.get('character_refs', []))} |",
            "",
            f"## 画面内容",
            f"- 前景：{shot.get('visual_foreground', '')}",
            f"- 主体：{shot.get('visual_subject', '')}",
            f"- 背景：{shot.get('visual_background', '')}",
            f"- 细节：{shot.get('visual_details', '')}",
            "",
            f"## 动作",
            f"{shot.get('action_description', '') or '（无）'}",
            "",
            f"## 光影",
            f"- 主光：{shot.get('lighting_key', '')}",
            f"- 辅光：{shot.get('lighting_fill', '')}",
            f"- 光比：{shot.get('lighting_ratio', '')}",
            f"- 氛围：{shot.get('lighting_mood', '')}",
            "",
            f"## 色彩",
            f"- 主导：{shot.get('color_dominant', '')}",
            f"- 点缀：{shot.get('color_accent', '')}",
            f"- 参照：{shot.get('color_reference', '')}",
            "",
            f"## 构图与空间",
            f"- 纵深：{shot.get('composition_depth', '')}",
            f"- 锚点：{shot.get('composition_anchor', '')}",
            f"- 方向：{shot.get('composition_direction', '')}",
            f"- 位置：{shot.get('spatial_position', '')}",
            f"- 前镜衔接：{shot.get('spatial_continuity_prev', '')}",
            f"- 后镜预留：{shot.get('spatial_continuity_next', '')}",
            "",
            f"## 音频",
            f"- 对白：{shot.get('dialogue_line', '') or '（无）'}",
            f"- 音效：{shot.get('sfx_marks', '') or '（无）'}",
            "",
            f"## 视频 Prompt（正面）",
            f"```",
            f"{shot.get('positive_prompt', '')}",
            f"```",
            "",
            f"## 视频 Prompt（负面）",
            f"```",
            f"{shot.get('negative_prompt', '')}",
            f"```",
            "",
        ]
        (out_dir / f"{shot_id}.md").write_text("\n".join(lines), encoding="utf-8")

        # Separate start frame prompt file (model data for Step 2)
        sf_prompt = shot.get("start_frame_prompt", "")
        if sf_prompt:
            (out_dir / f"{shot_id}_startframe.md").write_text(sf_prompt, encoding="utf-8")

    @staticmethod
    def _save_shot_deps(shot: dict, out_dir, characters: list[dict], scenes: list[dict]) -> None:
        """Save program-readable dependency references (IDs only, not prompts)."""
        deps = {
            "character_refs": shot.get("character_refs", []),
            "character_md_files": [
                f"characters/{c.get('ref_id')}.md"
                for c in characters if c.get("ref_id") in shot.get("character_refs", [])
            ],
            "scene_id": shot.get("scene_id", ""),
            "scene_md_file": f"scenes/{shot.get('scene_id', '')}.md",
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
