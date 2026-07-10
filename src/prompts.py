"""Prompt templates for the entire pipeline."""

# =============================================================================
# Step 1: DeepSeek Storyboard System Prompt
# =============================================================================

STORYBOARD_SYSTEM_PROMPT = """你是一位资深电影分镜师和导演。你的任务是将中文剧本转换为可执行的分镜脚本，供 AI 视频生成模型（Seedance 2.0）使用。

## 你的知识体系

### 景别（Shot Size）
- ELS（极远景）：环境为主，人物很小或不存在
- WS（全景）：人物全身可见，展示人物与环境关系
- FS（中全景）：人物膝盖以上，兼顾动作和环境
- MS（中景）：人物腰部以上，最常用的叙事景别
- MCU（中近景）：人物胸部以上，开始关注面部表情
- CU（特写）：面部或局部细节，强调情绪
- ECU（大特写）：眼睛、手部或物件细节，极端强调

景别选择原则：
- 对话场景以 MS 和 MCU 为主，穿插反应镜头（CU）
- 情绪高潮处用 CU 或 ECU
- 建立场景时用 WS 或 FS
- 动作戏用 MS 保持动作清晰，穿插 CU 强调细节
- 同一场景内景别要有变化，避免连续 3 个相同景别

### 机位与角度
- 眼平（Eye Level）：最自然，观众与角色平等
- 低角度（Low Angle）：角色显得强大、有压迫感
- 高角度（High Angle）：角色显得弱小、脆弱
- 过肩（Over-the-shoulder）：对话场景的标准机位
- 俯拍（Overhead/Top-down）：抽离感、上帝视角
- 荷兰角（Dutch Angle）：不安、失衡

### 运镜
- 固定（Locked-off）：最常用，画面稳定
- 缓推（Slow Push-in）：逐步接近，增强情感强度
- 缓拉（Slow Pull-out）：逐步远离，揭示更大语境或孤独感
- 跟拍（Tracking）：跟随角色移动
- 手持（Handheld）：轻微晃动，真实感、紧张
- 摇镜（Pan）：水平旋转，建立空间关系

### 180 度规则和轴线
对话场景中，两个角色之间的假想轴线。所有机位必须在轴线同一侧。为每场对话定义轴线，标注每个镜头中角色的屏幕方向和视线方向。

### 光线
每个镜头定义：主光方向/类型/色温、辅光方向和光比。
光比：2:1（亮调/喜剧）、3:1（正常）、4:1 以上（暗调/惊悚）。

### 色彩
主导色调和情感关联（暖=亲密/怀旧，冷=疏离/压抑），饱和度倾向，视觉风格参照。

### 构图
三分法、纵深层次（前景/中景/背景）、视线引导、负空间。

## 衔接类型
- A 类（连续动作）：同一角色的连续运动，需要起止帧对齐
- B 类（视角切换）：切换视角或角色，同一时空
- C 类（时间跳跃）：时间推进
- D 类（场景切换）：场景改变

## 输出格式

先输出全局【角色字典】和【场景字典】，再逐场景输出【分镜序列】。

每个镜头使用以下模板：

```
【镜头编号 | 时长秒数 | 衔接类型】

镜头规格
  景别：[景别]
  机位：[机位描述]
  运镜：[运镜描述]

画面内容
  · [前景元素]
  · [主体：角色、位置、动作]
  · [背景]
  · [关键细节]

光影
  主光：[方向、类型、色温]
  辅光：[来源、效果]
  光比：[数字]:1
  氛围：[光线传达的情绪]

色彩
  主导色：[颜色 + 情感关联]
  点缀色：[颜色]
  质感参照：[具体电影/摄影师/胶片]

构图
  纵深层次：[前景→中景→背景]
  视觉锚点：[最亮/最吸引视线的区域]
  分割与方向：[画面中的角色位置和屏幕方向]

空间信息
  角色位置与方向：[位置 + 面对朝向]
  屏幕方向：[角色在画左/右，视线向左/右]
  上镜衔接：[衔接说明]
  下镜预留：[为下一镜预留的空间/视线信息]

音频
  对白：角色名 — "台词"（语气）
  音效：[类型 + 大致时间点]
  环境音：[延续场景的环境音]

视频生成 Prompt（正面）
  [英文详细画面描述，包含景别/角度/运镜/角色(Image引用)/动作/光影/色彩/质感/画幅]

视频生成 Prompt（负面）
  [英文需要排除的元素]
```

## 质量要求
1. 每个镜头 prompt 包含具体视觉信息，避免抽象情绪描述
2. 相邻镜头空间关系自洽（视线方向、位置关系）
3. 对话场景遵守 180 度规则
4. 景别序列有意义地变化
5. 光线和色彩在场景内保持一致
6. 角色外貌从角色字典引用，全片一致
7. Prompt 用中文（和剧本语言保持一致）
8. 画面内容和 prompt 中涉及的角色，标注引用 "见 ImageN"（N 为角色在角色字典中的序号，从 1 开始）"""

STORYBOARD_USER_PROMPT = """请分析以下剧本，生成完整的电影分镜脚本。

{script_text}"""


# =============================================================================
# Step 2: Image Generation Prompts
# =============================================================================

CHARACTER_PORTRAIT_FRONT = """\
Professional character portrait, chest-up. {name}, {gender}, {age} years old. \
{face_features}. {hair}. Natural, neutral expression with subtle {mood} look. \
{clothing_collar}. Studio lighting: soft key light from 45 degrees left, \
subtle fill from right, gentle catchlight in eyes. Neutral dark grey background. \
Shallow depth of field, shot on 85mm f/1.4 lens. Photorealistic, 8K, \
cinematic color grading."""


CHARACTER_PORTRAIT_PROFILE = """\
Professional character portrait, 45-degree profile view. {name}, {gender}, \
{age} y/o. {face_features}. {hair} - full hairstyle visible from side. \
{clothing_upper}. Similar expression to front portrait, with subtle variation. \
Studio lighting matching front portrait: consistent color temperature and \
contrast ratio. Mid-grey background. Photorealistic, 8K."""


CHARACTER_FULL_BODY = """\
Full body standing shot. {name}, {gender}, {age} y/o. {face_features}. \
{full_outfit}. Standing naturally, relaxed posture, facing slightly off-camera. \
In a softly lit neutral interior with warm ambient. Full body visible from \
head to toe. Cinematic lighting, Arri Alexa look, photorealistic, 8K."""


SCENE_REFERENCE_WIDE = """\
Cinematic wide shot of {location_description}, {time_of_day}. \
{spatial_description}. {lighting_description}. {color_mood}. \
{key_props_and_positions}. {window_exterior}. \
No characters in frame. Empty establishing shot. Architectural Digest \
photography meets Denis Villeneuve aesthetic. Shot on Arri Alexa 65, \
anamorphic lenses. Photorealistic, 8K, 16:9 aspect ratio."""


SCENE_REFERENCE_DETAIL = """\
Cinematic close-up detail of {object_description}, {position}. \
{lighting} falling across the surface. {texture_detail}. {condition}. \
Macro detail, shallow depth of field, cinematic color grading. \
Photorealistic, 8K, 16:9 aspect ratio."""


# =============================================================================
# Step 3: Video Generation Prompt Assembly
# =============================================================================

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
    parts.append("16:9, 1080p, cinematic.")

    return " ".join(parts)


VIDEO_NEGATIVE_PROMPT = (
    "direct eye contact with camera, breaking the fourth wall, smiling, "
    "laughing, bright daylight, high contrast, oversaturated, cartoon, "
    "anime, CGI, 3D render, smooth digital video, smartphone footage, "
    "text, watermark, logo, letterbox bars, blurry, low quality, "
    "distorted face, extra limbs, mutated hands, bad anatomy, "
    "mismatched lighting, inconsistent shadows"
)


# =============================================================================
# Step 4: Audio Prompts
# =============================================================================

AMBIENCE_GENERATION_PROMPT = """\
{scene_ambience_description}. Continuous ambient soundscape, 2 minutes, \
seamless loopable. High quality field recording style, stereo, 48kHz."""


SFX_GENERATION_PROMPT = """\
{sound_description}. Clean isolated sound effect, 2-5 seconds, \
high quality foley recording style, mono, 48kHz."""


BGM_GENERATION_PROMPT = """\
{emotion} instrumental background music for a {scene_type} scene. \
{mood_description}. {duration} seconds, gradual dynamic arc. \
Cinematic underscore style, {genre_reference}. No vocals, no percussion solos."""


# =============================================================================
# Step 4b: TTS Voice Profile Prompt
# =============================================================================

TTS_VOICE_PROFILE = """\
Create a voice profile for {character_name}:
- Gender: {gender}
- Age: {age}
- Voice quality: {voice_description}
- Speaking style: {speaking_style}
- Emotional range: {emotional_range}

This voice will be used for text-to-speech generation of dialogue lines."""


# =============================================================================
# Step 5: Subtitles Style
# =============================================================================

SUBTITLE_STYLE = {
    "fontname": "Noto Sans CJK SC",
    "fontsize": 24,
    "primary_color": "&H00FFFFFF",      # White
    "outline_color": "&H00000000",      # Black outline
    "outline_width": 1.5,
    "alignment": 2,                      # Bottom center
    "margin_v": 60,
}
