# AI 剧本到电影系统 — 设计文档

## 目录

1. [系统概述](#1-系统概述)
2. [架构总览](#2-架构总览)
3. [Step 1：剧本解析与分镜生成](#3-step-1剧本解析与分镜生成)
4. [Step 2：视觉素材库](#4-step-2视觉素材库)
5. [Step 3：视频生成](#5-step-3视频生成)
6. [Step 4：音频制作](#6-step-4音频制作)
7. [Step 5：后期合成](#7-step-5后期合成)
8. [分镜数据协议](#8-分镜数据协议)
9. [Seedance 图片配额策略](#9-seedance-图片配额策略)
10. [衔接处理策略](#10-衔接处理策略)
11. [已知风险与缓解](#11-已知风险与缓解)
12. [附录：全部 Prompt 模板](#12-附录全部-prompt-模板)

---

## 1. 系统概述

### 1.1 目标

输入一份中文剧本，输出一部完整的电影视频。全流程 AI 驱动，人工可在分镜阶段介入调整。

### 1.2 技术选型

| 环节 | 引擎 |
|------|------|
| 剧本解析 & 分镜 | DeepSeek（R1 推理 / V3 大批量） |
| 角色/场景定妆照 | Stable Diffusion / Flux / Midjourney |
| 视频生成 | Seedance 2.0（多图参考模式） |
| TTS 对白 | ElevenLabs / GPT-SoVITS |
| 环境音 & 音效 | ElevenLabs SFX / Stable Audio |
| BGM | Suno / Udio |
| 口型同步 | Wav2Lip（备选方案） |
| 视频合成 | FFmpeg / MoviePy |

### 1.3 设计原则

- **分镜是核心数据协议**：所有下游环节从分镜序列驱动，分镜即指令
- **自然语言为主，元数据为辅**：视频模型只认 prompt，结构性字段只服务于程序化编排（时长、衔接、音效对齐）
- **可干预**：分镜序列是人可读可编辑的中间产物，质量不理想时可手动调整再继续
- **先跑通再优化**：每个环节优先用最简单的可行方案，验证后再替换为更优方案

---

## 2. 架构总览

```
输入：剧本
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Step 1  剧本分镜                               │
│ 引擎：DeepSeek R1                                        │
│ 输出：角色字典 + 场景字典 + 分镜序列                       │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│ Step 2  视觉素材库                                       │
│ 引擎：SD / Flux / Midjourney                             │
│ 输入：角色字典 + 场景字典                                 │
│ 输出：定妆照（每角色 ×3）+ 场景参考图（每场景 ×1-2）       │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│ Step 3  视频生成                                         │
│ 引擎：Seedance 2.0（多图参考模式）                        │
│ 输入：分镜 prompt + 定妆照 + 场景参考图 + 起止帧           │
│ 输出：视频片段 × 镜头数                                   │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│ Step 4  音频制作                                         │
│ TTS 对白 + AI 环境音 + 音效库匹配 + Suno BGM              │
│ 备选：Wav2Lip 口型同步                                    │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│ Step 5  后期合成                                         │
│ FFmpeg：拼接 + 转场 + 多轨音频 + 调色 + 字幕              │
│ 输出：成片 mp4                                            │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Step 1：剧本解析与分镜生成

### 3.1 输入

完整中文剧本（TXT/PDF/Markdown）。

### 3.2 处理逻辑

分两阶段执行。第一阶段做全局解析，第二阶段逐场做分镜。

#### 阶段一：全局剧本解析

1. 识别所有角色：姓名、年龄、外貌特征、性格、台词风格
2. 识别所有场景：场景编号、内/外景、地点、时间、空间描述
3. 梳理叙事结构：场景序列、情绪弧线、关键转折点
4. 输出角色字典和场景字典

#### 阶段二：逐场分镜

对每个场景：
1. 分析该场景的戏剧功能（建立/推进/转折/高潮/收束）
2. 确定节奏基调（根据场景类型：对话/动作/情绪/过渡）
3. 拆解为 3-15 个镜头，逐镜头填充完整规格
4. 标注衔接类型（A 连续动作 / B 视角切换 / C 时间跳跃 / D 场景切换）
5. 检查连续性规则（跳轴检测、景别序列、空间关系）
6. 输出该场分镜序列

### 3.3 输出

- `角色字典` — 所有角色信息
- `场景字典` — 所有场景信息
- `分镜序列` — 按场景组织的完整分镜（格式见 [分镜数据协议](#8-分镜数据协议)）

### 3.4 DeepSeek System Prompt

见 [附录 A](#a1-deepseek-分镜-system-prompt)

---

## 4. Step 2：视觉素材库

### 4.1 目标

为后续视频生成提供稳定的视觉参考——角色长这样、场景长这样。所有参考图在 Step 3 中以 @Image 方式喂入 Seedance。

### 4.2 每角色定妆照

| 序号 | 类型 | 用途 |
|------|------|------|
| Image_A | 正面肖像（胸像） | 面部特征锚定 |
| Image_B | 半侧面（45°） | 侧脸特征、发型完整 |
| Image_C | 全身站立 | 体型、服装完整 |

### 4.3 每场景参考图

| 序号 | 类型 | 用途 |
|------|------|------|
| Image_S1 | 场景主视角（广角） | 空间布局锚定 |
| Image_S2 | 场景关键元素特写 | 重要道具/光源（可选） |

### 4.4 生成 Prompt 模板

见 [附录 B](#a2-角色定妆照-prompt-模板) 和 [附录 C](#a3-场景参考图-prompt-模板)。

---

## 5. Step 3：视频生成

### 5.1 引擎

Seedance 2.0，多图参考模式。

### 5.2 单镜头生成流程

```
准备阶段：
  1. 从分镜中提取该镜头的角色列表、场景编号
  2. 从素材库选取对应角色的定妆照（@Image1..N）
  3. 从素材库选取场景参考图（@Image）
  4. A 类衔接镜头：取上一镜的末帧作为起始帧参考（@Image）
  5. 组装完整 prompt（正面描述 + 负面描述）

生成阶段：
  6. 调用 Seedance API，传入参考图和 prompt
  7. 每条生成 2-3 个候选
  8. 自动/人工选优，标记最佳候选

质量检查：
  9. 人脸清晰可辨
  10. 光影与参考图一致
  11. 运动平滑无撕裂
  12. 时长在容差范围内（±0.5s）
```

### 5.3 Seedance 调用参数

```
model: seedance-2.0
images: [角色定妆照 × N, 场景参考图, 可选起始帧]
prompt: 正面描述 + 负面排除
duration: 分镜指定时长（或 auto）
aspect_ratio: 16:9
resolution: 1080p
```

### 5.4 视频生成 Prompt 组装规则

见 [附录 D](#a4-视频生成-prompt-组装规则)。

---

## 6. Step 4：音频制作

### 6.1 音频分层

```
成片音频
  ├── 对白层      TTS 逐句生成 → 按时间轴放置
  ├── 环境音层    按场景生成长音轨 → 循环铺设
  ├── 音效层      从分镜标记提取 → 音效库匹配 → 时间戳对齐
  └── BGM 层      按场景情绪分段生成 → 音量包络
```

### 6.2 对白层

**方案 A（首选）：Seedance 原生音频**

Seedance 2.0 支持音视频同步生成，首选用原生方式。优点是不需要额外对口型。

**方案 B（备选）：TTS + Wav2Lip**

如果原生音频不满足需求：
1. 用角色字典中的声音描述，在 ElevenLabs / GPT-SoVITS 中为每个角色创建声音
2. 分镜中的每句台词生成 TTS 音频
3. Wav2Lip 逐镜头将口型贴合到视频片段上

### 6.3 环境音层

1. 从场景字典提取环境音描述
2. ElevenLabs SFX / Stable Audio 生成 1-2 分钟环境音循环
3. 按场景跨度铺设，场景切换时交叉淡入淡出（2s）
4. 对话时环境音降低 8-12dB

### 6.4 音效层

1. 从分镜标记提取音效事件（类型 + 时间戳）
2. 从音效库（Freesound / AI SFX）匹配最接近的音效文件
3. FFmpeg 按时间戳精确放置到时间轴

### 6.5 BGM 层

1. 从分镜中提取场景情绪标签
2. Suno / Udio 为每个情绪段落生成主题变奏
3. 后期混音时对 BGM 做音量包络：对白时 -12dB，对白间隙恢复

### 6.6 混音参数

```
对白：-3dB 基准
环境音：-18dB ~ -12dB（对话时自动衰减）
音效：-6dB（峰值）
BGM：-15dB（对话时 -25dB）
总输出：-1dB 峰值限制
```

---

## 7. Step 5：后期合成

### 7.1 合成流程

```
视频片段 [v001.mp4, v002.mp4, ...]
    │
    ├── 按时间轴拼接（concat demuxer）
    ├── 转场叠加（按分镜标注：硬切/叠化/淡入淡出）
    ├── 统一调色（3D LUT）
    ├── 时长微调（变速 ±10%，对齐分镜时长）
    │
音频轨道
    ├── 对白（按时轴放置）
    ├── 环境音（循环 + 交叉淡入淡出）
    ├── 音效（按时戳放置）
    └── BGM（音量包络）
    │
    ├── 多轨混音
    ├── 响度标准化（LUFS -16）
    │
字幕
    └── SRT 叠加
    │
输出：final.mp4
```

### 7.2 工具链

| 操作 | 工具 |
|------|------|
| 视频拼接 | FFmpeg concat demuxer |
| 转场 | FFmpeg xfade / MoviePy |
| 调色 | FFmpeg lut3d 滤镜 |
| 变速 | FFmpeg setpts 滤镜 |
| 多轨混音 | FFmpeg amix + volume 滤镜链 |
| 字幕 | FFmpeg subtitles 滤镜 |

### 7.3 FFmpeg 关键命令模板

```bash
# 拼接视频片段
ffmpeg -f concat -safe 0 -i concat_list.txt -c copy intermediate.mp4

# 统一调色
ffmpeg -i intermediate.mp4 -vf "lut3d=film_look.cube" graded.mp4

# 多轨混音
ffmpeg -i graded.mp4 -i dialogue.wav -i ambience.wav -i sfx.wav -i bgm.wav \
  -filter_complex "[1]volume=0.7[a];[2]volume=0.15[b];[3]volume=0.5[c];[4]volume=0.08[d];[a][b][c][d]amix=inputs=4:duration=first:weights=1 0.15 0.5 0.08" \
  -c:v copy final.mp4

# 字幕叠加
ffmpeg -i final.mp4 -vf "subtitles=subtitles.srt:force_style='FontSize=24,PrimaryColour=&H00FFFFFF'" output.mp4
```

---

## 8. 分镜数据协议

分镜是系统核心数据协议。DeepSeek 输出此格式，所有下游环节从此格式驱动。

### 8.1 完整字段定义

```
角色字典
  角色 ID | 角色名（如 ANNA）
    - 年龄、性别
    - 外貌特征（身高、体型、脸型、五官、发型发色、标志特征）
    - 服装描述（每场可换装）
    - 声音描述（音色、语速、说话习惯）
    - 性格关键词

场景字典
  场景 ID | 场景名（如 SC_03_公寓客厅）
    - 地点、时间（日/夜/时段）
    - 空间描述（面积、方位、关键物件位置）
    - 光线描述（光源类型、色温、方向、氛围）
    - 色调（主色调、饱和度、质感参照）
    - 环境音（持续音 + 偶发音）

分镜序列（逐镜头）
  [镜头号 | 时长秒数 | 衔接类型]
  
  镜头规格
    景别：ELS/WS/FS/MS/MCU/CU/ECU
    机位：眼平/低角度/高角度/俯拍/过肩
    运镜：固定/缓推/缓拉/跟拍/摇镜/手持
  
  画面内容
    前景、主体、背景、动作、关键细节
  
  光影
    主光、辅光、光比、色温、氛围
  
  色彩
    主导色、点缀色、饱和度、质感参照
  
  构图
    纵深层次、视线引导、负空间、画面分割
  
  空间信息
    角色位置、面对方向、屏幕方向
    上镜衔接说明
    下镜衔接预留
  
  音频
    台词（逐句，含语气标注）
    音效（类型 + 时间戳）
    环境音（继承场景）
  
  视频生成 Prompt
    prompt_positive: 英文正面描述
    prompt_negative: 英文负面排除
  
  预期输出
    分辨率、时长容差、质量阈值、备选数量
```

### 8.2 完整分镜示例

```
========== 角色字典 ==========

角色 CH_01 | ANNA
  年龄：32 岁，女性
  外貌：身高 165cm，偏瘦。瓜子脸，高颧骨，深棕色齐耳短发（发尾微卷）。
        深褐瞳色，薄唇，左眉上方有一颗小痣（直径1mm）。
        左手腕内侧有一道 2cm 旧伤疤。
  服装：灰色羊毛中长外套（过臀），内搭黑色高领毛衣，深蓝直筒牛仔裤，
        黑色短靴。银色细链项链（锁骨位置）。
  声音：女中音，说话慢而稳，句尾常带轻微下降。紧张时习惯性停顿，
        偶尔在句子中间吞咽一下再继续。
  性格：克制、敏感、内心有未解决的愧疚

角色 CH_02 | BOB
  年龄：41 岁，男性
  外貌：身高 178cm，微胖。方脸，下颌线模糊，短发灰白相间。
        浅褐瞳色，眉间有川字纹。右手佩戴银色机械表（表盘有细痕）。
  服装：藏蓝色牛津衬衫（微皱，袖口卷至前臂中段），深灰休闲裤，
        棕色皮带。左手无名指婚戒痕迹（已摘下）。
  声音：男中音，略微沙哑，语速偏快但音量不大。说话时习惯用手指
        轻敲桌子或膝盖。
  性格：疲惫、直率、压抑愤怒

========== 场景字典 ==========

场景 SC_03 | 安娜的公寓客厅
  地点：城市老式公寓 12 层
  时间：雨夜，约晚上 9 点
  空间：面积约 20㎡。入户门在北墙（左侧），南墙为两扇落地窗，窗外是城市街景。
        东墙靠一张深灰布艺三人沙发（稍有使用痕迹），沙发前是长方形木质茶几
        （橡木色，台面有杯印）。沙发右侧有一张边几，上放一盏暖黄布罩台灯。
        西墙是开放式厨房吧台（白色台面，上方两盏射灯）。房间中央铺灰米色地毯。
        墙上有一幅黑白城市摄影（30×40cm，在沙发上方）。
  光线：主光源为沙发边几的暖黄台灯（2700K），照亮房间主要区域。
        窗外街灯为钠黄色（2200K），通过窗户渗入冷调补充光。
        雨水在窗玻璃上流动，对街霓虹隐约泛淡红色光斑。
        整体光线偏暗，阴影柔和，光比约 3:1。
  色调：主导色暖黄 + 深灰 + 棕。低饱和度。光影质感参照 Denis Villeneuve
        电影（Arrival / Blade Runner 2049 室内场景）。
  环境音：中雨打在窗玻璃上的持续声。每隔约 15-30s 远处有车辆驶过湿路面
        的溅水声。隔壁偶尔传来模糊的电视声（低频，几乎不可闻）。

场景 SC_06 | 雨后街道
  地点：公寓楼下街道
  时间：雨后，深夜约 11 点
  空间：狭窄的单行道，两侧为 6 层老式公寓楼。湿漉的沥青路面反射路灯。
        路边停着几辆车。行道树（梧桐）叶子滴水。
  光线：高压钠灯路灯（橘黄色 2200K），地面水洼反射暖光。
        楼间几扇亮着的窗户提供零星冷白光补充。
        低对比度，空气中有薄雾感。
  色调：主导橘黄 + 深蓝黑。较低饱和度。质感参照 After Hours（Scorsese）
        中的纽约夜晚街道。
  环境音：滴水声（多方向），远处偶尔的脚步声和车门关闭声。低频城市嗡嗡声。

========== 分镜序列 ==========

---

【SC03_SHOT01 | 6s | D 类衔接（新场景建立）】

镜头规格
  景别：中景 → 大特写（缓推）
  机位：室内，正对窗户，眼平高度
  运镜：缓推，6s 内从包含窗户和部分室内→推至玻璃水痕特写

画面内容
  · 前景：窗框（隐约在画面边缘）
  · 主体：雨夜街道，透过窗玻璃看到。远处车灯（红/白）在湿路面上拖出光晕。
  · 元素：水珠沿玻璃缓缓滑落，窗外街灯橘黄光晕。远处的霓虹闪烁（淡红，无
    法辨认字样）。室内窗台上有一小盆枯了一半的绿植（右侧边缘）。
  · 细节：玻璃上凝结的水珠，一颗大水珠在约画面左下 1/3 处开始往下滑。

光影
  主光：窗外街灯的橘黄光，透过水痕窗玻璃形成漫射
  辅光：本镜无明确室内光（台灯尚未出现在画面中）
  氛围：孤寂、沉思、时间感模糊

色彩
  主导色：深蓝黑（室外） + 橘黄光斑
  点缀色：霓虹淡红（远处，低饱和度）
  质感参照：Blade Runner 2049 城市夜景

构图
  纵深层次：窗玻璃上的水珠（最近）→ 窗外街景（中）→ 远处城市灯火（远）
  视线引导：水珠滑落轨迹自然引导视线下移

空间信息
  机位在公寓内，面对南墙窗户。未建立房间其他部分。

音频
  对白：无
  音效：无
  环境音：雨声（中雨，持续），远处车过（第一秒和第五秒各一次）

视频生成 Prompt（正面）
  Cinematic medium shot, slow push-in over 6 seconds towards a rain-streaked
  window. Interior of a dim apartment room facing a city street at night.
  Rain streaming down the window glass, water droplets sliding slowly. Outside
  the window: wet asphalt street, amber sodium streetlights (2200K) casting
  warm orange glow, blurred red and white taillights of distant cars reflecting
  on the wet road. Neon sign faint pink glow in the far distance (unreadable).
  Right edge of frame: a small potted plant on the windowsill, half-wilted.
  The push-in ends with focus on a large water droplet sliding down the glass.
  Shallow depth of field, cinematic lighting, Arri Alexa look, desaturated.
  Kodak 5219 film grain, 16:9, 1080p.

视频生成 Prompt（负面）
  Bright daylight, direct sunlight, oversaturated colors, digital video look,
  wide angle lens, cartoon style, CGI, people visible, interior strongly lit,
  clear dry window, text overlays, watermarks, symmetrical composition

预期输出
  分辨率：1080p, 16:9
  时长容差：±0.5s
  质量阈值：水珠细节清晰，光影氛围正确，推镜平滑

---

【SC03_SHOT02 | 4.5s | A 类衔接（连续动作）】

镜头规格
  景别：中景
  机位：室内，靠近入户门位置，眼平高度
  运镜：固定（lock-off）

画面内容
  · 前景：门框左侧（占画面左 1/5），门已被推开半开状态
  · 主体：安娜的背影，她正从门外跨入室内。灰色羊毛外套上有雨水痕迹（肩部
    微湿）。右手拿着折叠伞（深蓝色，还在滴水）。
  · 动作：她跨过门槛后停顿了约 1.5s，手仍然握着门把手。然后她向前迈一步进
    入客厅深处，让门在身后缓缓合上（门未关严）。
  · 背景：室内深灰沙发、木质茶几、暖黄台灯光可见。窗外雨景（与 SHOT01 呼
    应）。房间整体偏暗但温暖。
  · 细节：安娜左手在身体侧微微攥拳又松开。

光影
  主光：室内台灯暖黄（2700K），从右前方打在安娜身上（她面朝室内，右侧被
        照亮）
  辅光：走廊冷白光（门外的楼道灯，约 4000K）从身后打入，给安娜左侧轮廓
        一道冷色边缘光
  光比：约 2.5:1
  氛围：温暖室内与冷湿室外的对比，回家的瞬间

色彩
  主导色：暖黄（室内）+ 冷灰蓝（室外走廊）
  点缀色：安娜外套的深灰、伞的深蓝
  质感参照：Sicario 室内夜戏的光线处理

构图
  纵深层次：门框（最近）→ 安娜背影（中近）→ 客厅/台灯/沙发（远）
  视觉锚点：台灯的暖黄亮区吸引视线，安娜剪影般立于前景
  画面分割：左侧（门/走廊/冷调）vs 右侧（室内/台灯/暖调）

空间信息
  安娜位置站在门口（北墙），面向室内深处（向南）。SHOT01 中建立的窗户在
  背景远方可见。安娜从画左向画右略偏深移动。
  上镜衔接：SHOT01 是本场景建立镜头，本镜是角色引入，无需起止帧对齐。
  下镜衔接：安娜走到茶几位置（约 3m），下一镜（SHOT03）将从茶几方向拍摄
  安娜正面。A 类衔接，需要 SHOT02 末帧作为 SHOT03 起始帧。

音频
  对白：无
  音效：门开声（shot 开始时 0.3s）、脚步声×2（湿鞋底在木地板上）
  环境音：雨声（比 SHOT01 稍轻，因在室内），远处车过

视频生成 Prompt（正面）
  Medium shot, locked-off camera, interior apartment doorway. A woman
  (Anna, see Image1 for reference — short dark brown hair, grey wool coat,
  black high-neck sweater underneath, 165cm, slim build, small mole above
  left eyebrow) enters from the left, shot from behind. She steps through
  the doorway, pauses for a moment with her right hand on the door handle.
  Her grey coat has light rain speckles on the shoulders. She holds a dark
  blue folding umbrella (dripping). Behind her through the doorway: cold
  corridor light (~4000K, creating a cool rim light on her left silhouette).
  Ahead of her: warm tungsten table lamp (2700K) illuminating a cozy
  apartment living room with a grey sofa and wooden coffee table. She steps
  forward and the door slowly swings mostly shut behind her. Rain-streaked
  window visible in the deep background. 2.5:1 lighting ratio, cinematic
  color grading, Arri Alexa, shallow depth of field, 16:9, 1080p.

视频生成 Prompt（负面）
  Anna facing camera, smiling, bright overhead lighting, empty room,
  modern minimalist interior, wide angle distortion, smooth digital video,
  cartoon look, text, watermark

预期输出
  分辨率：1080p, 16:9
  时长容差：±0.5s
  质量阈值：角色与定妆照一致、冷暖光对比明显、动作自然

---

【SC03_SHOT03 | 3.2s | A 类衔接（起止帧对齐）】

镜头规格
  景别：中近景（MCU）
  机位：茶几后方，比安娜视线略低（低角度，约在安娜胸部高度），
        过肩视角（越过茶几拍摄）
  运镜：固定（lock-off）

画面内容
  · 前景底部：茶几台面边缘（橡木色，模糊），台面上有一只空玻璃杯（杯口
    有淡色唇印）
  · 主体：安娜，画面右上 2/3 位置。她从室内深处走向茶几，现站定在茶几前。
    画面中可以看到她腰部以上。她低头看茶几上的空杯子。
  · 动作：她站定后 1s，低头看到杯子。视线在杯子上停留。右手在身侧微微抬起
    又放下（想拿杯子又犹豫）。
  · 面部：表情平淡但眼神复杂——盯着杯子像在看某段记忆。台灯光从右侧照亮
    她半边脸，左侧脸在暗影中。左眉上小痣可见。
  · 细节：杯子边缘的淡色唇印暗示之前有人用过。安娜左手的旧伤疤在袖口下
    若隐若现。

光影
  主光：台灯暖黄（2700K），从画面右上打来，照亮安娜右脸和额头
  辅光：窗外街灯和环境散射，极弱，仅让左脸不至于全黑
  光比：3:1，偏暗调（low key）
  氛围：私密、压抑、内心冲突

色彩
  主导色：暖黄 + 深棕阴影
  点缀色：杯中透明玻璃的反光点、安娜唇色（淡，几乎不上色）
  质感参照：Arrival 中 Louise 在家中的侧光特写

构图
  前景虚化（茶几+杯子）构成深度参照。安娜面部在右上 2/3 黄金分割点附近。
  视线引导：杯子的高光 → 安娜的脸（跟随她视线）。她的低头俯视创造画面的
  下沉感。负空间在她的左侧（暗部）——暗示缺失和孤独。

空间信息
  安娜站在茶几前，距门约 3m，面向南（窗户方向），实际视线向下。机位在茶几
  后方（南侧），朝北拍摄。安娜在画右，视线朝画左下（看茶几上的杯子）。
  上镜衔接（A 类）：SHOT02 末帧安娜位置与 SHOT03 起帧一致。需要将 SHOT02
  最后一帧导出，作为本镜的起始帧（@Image）。安娜从门走到茶几，位置不变。
  下镜衔接：安娜的低头视线引导向杯子，预留 SHOT04 杯子大特写的动机。

音频
  对白：无
  音效：无（安娜脚步已停）
  环境音：雨声（持续），远处车过（偶发）

视频生成 Prompt（正面）
  Medium close-up, low angle slightly below eye-line, locked-off camera,
  over-the-table perspective. Anna (see Image1 — short dark brown hair,
  grey wool coat, slim, small mole above left eyebrow) stands by a wooden
  coffee table in her dim apartment. Shot from waist up, she occupies the
  right two-thirds of the frame. She looks down at an empty drinking glass
  on the table (foreground, blurred). The glass rim has faint lipstick mark.
  Key light: warm tungsten table lamp (2700K) from upper right, illuminating
  the right side of her face. The left side of her face falls into deep shadow
  (3:1 ratio, low key). Her expression is blank but her eyes hold a complex
  weight — she stares at the glass as if remembering something painful. Her
  right hand lifts slightly then drops. Old scar visible on her left wrist.
  Rain-streaked window in the deep background (out of focus). Shallow depth
  of field, only her face in sharp focus. Cinematic, Arri Alexa, Kodak 5219
  film grain. 16:9, 1080p.

视频生成 Prompt（负面）
  Anna smiling, looking at camera, brightly lit room, flat lighting, high
  key, wide angle, CGI, cartoon, text, watermark, two people in frame

预期输出
  分辨率：1080p, 16:9
  时长容差：±0.3s
  质量阈值：脸部与定妆照一致、低影调正确、低头视线的情感传达到位
  备选：生成 3 条选优

---

【SC03_SHOT04 | 3s | B 类衔接（视角切换——反应镜头）】

镜头规格
  景别：中近景（MCU）
  机位：沙发侧后方，过肩。鲍勃的后脑勺和右肩在画面左前景。
  运镜：缓推（3s 内极微幅推进，约 5%），给鲍勃的沉默增加压迫感

画面内容
  · 前景左侧：鲍勃的右肩和后脑勺（虚化），藏蓝衬衫纹理隐约可见
  · 主体：安娜，中近景，画面偏右 1/3。她仍在低头看杯子，面部朝下。
  · 动作：安娜没有说话，右手无意识地摩挲左手腕的旧伤疤（SHOT03 建立的
    细节延续）。鲍勃的画外存在感通过前景过肩位建立。
  · 细节：安娜左眉上小痣、左手腕伤疤在台灯光下可见

光影
  与 SHOT03 一致：台灯暖黄主光（2700K），右侧亮左侧暗，3:1 光比

色彩
  与 SHOT03 一致。但画面中鲍勃的藏蓝衬衫（前景左）提供了新的冷色块，
  与安娜右脸的暖黄形成冷暖对比。

构图
  画面左侧的鲍勃（虚化）提供深度和对话关系，安娜在右侧。鲍勃在物理上
  "介入"了她的画面——暗示两人的关系。

空间信息
  机位在沙发（东墙）后方，向西北方向拍摄。安娜在茶几前（画面右侧），
  鲍勃坐在沙发上（画面前景左）。安娜视线方向朝左下（看茶几上的杯子）。
  上镜衔接（B 类）：SHOT03 安娜看杯子 → SHOT04 从鲍勃视角看安娜看杯子。
  不需要起止帧对齐，但需要 SHOT03 中视线向下方向与 SHOT04 空间关系一致性。
  下镜衔接：预留鲍勃正面反应（SHOT05），鲍勃视线方向需匹配安娜位置。

音频
  对白：安娜 — "我不确定我该回来。"（语气：轻声、犹豫、句尾轻微颤抖）
  音效：无
  环境音：雨声（持续）

视频生成 Prompt（正面）
  Medium close-up, over-the-shoulder shot, slow subtle push-in (5% over 3s).
  Bob's blurred right shoulder and back of head in the left foreground
  (dark blue wrinkled oxford shirt). Anna (see Image1) in the right third of
  the frame, eye-level. She stands by the coffee table, gaze lowered, looking
  at an empty glass off-screen. Warm tungsten table lamp (2700K) from the right
  illuminates half her face, the left side in shadow (3:1 low-key lighting).
  Her right hand unconsciously rubs the old scar on her left wrist. Her
  expression carries unspoken tension — she is about to speak but hesitates.
  The blue of Bob's shirt (left foreground, blurred) creates a cool color
  contrast with the warm light on Anna's face. Rain-streaked window deep in
  background. Shallow depth of field, f/2.8. Cinematic, Arri Alexa, Kodak 5219.
  16:9, 1080p.

视频生成 Prompt（负面）
  Both characters in sharp focus, Anna looking at camera, smiling, bright
  room, flat lighting, cartoon, CGI, text, watermark

预期输出
  分辨率：1080p, 16:9
  时长容差：±0.3s
  质量阈值：过肩位的空间关系正确、光影与 SHOT03 连续、两个角色各在其位
  备选：生成 3 条选优
```

---

## 9. Seedance 图片配额策略

Seedance 2.0 每次生成最多引用 9 张图片。配额分配规则：

### 9.1 分配优先级

```
优先级 1：本镜头角色定妆照（必选）
优先级 2：场景参考图（必选）
优先级 3：A 类衔接起始帧（条件必选）
优先级 4：关键道具/细节参考（可选）
优先级 5：上一镜头末帧（可选，用于运动参考）
```

### 9.2 不同场景类型的具体分配

| 镜头类型 | 角色数 | 每人图数 | 场景图 | 起始帧 | 道具 | 总消耗 | 状态 |
|---------|--------|---------|--------|--------|------|--------|------|
| 独角戏 | 1 | 3 | 1 | 0/1 | 0 | 4-5 | ✅ |
| 双人对话 | 2 | 2 | 1 | 0/1 | 0 | 5-6 | ✅ |
| 三人戏 | 3 | 2 | 1 | 0/1 | 0 | 7-8 | ✅ |
| 四人及以上 | 4+ | 1 | 1 | 0/1 | 0 | 6-9 | ⚠️ |
| 空镜（无角色）| 0 | 0 | 2 | 0/1 | 1 | 3-4 | ✅ |

### 9.3 超配额降级策略

当镜头角色数 > 4 且需起始帧时，裁减方案（按优先级）：
1. 减少每人定妆照到 1 张（仅正面肖像）
2. 合并场景参考图（2 张 → 1 张最全景别）
3. 放弃起始帧 → 从 A 类降级为 B 类衔接，靠剪辑掩盖
4. 放弃道具/细节参考图

---

## 10. 衔接处理策略

分镜生成时，每个镜头需标注衔接类型。后期处理按类型区别对待。

```
            ┌─ A 类（连续动作）────→ 起止帧对齐 → 硬切 ───────────┐
            │   SHOT02→SHOT03：安娜从门走到茶几                      │
            │                                                         │
            ├─ B 类（视角切换）────→ 独立生成 → 硬切 / J-cut ──────┤
镜头衔接 ───┤   SHOT03→SHOT04：安娜看杯子 → 从鲍勃视角看安娜          │
            │                                                         │
            ├─ C 类（时间跳跃）────→ 独立生成 → 叠化 / 淡入淡出 ────┤
            │   "一小时后..."                                         │
            │                                                         │
            └─ D 类（场景切换）────→ 独立生成 → 淡入淡出 / L-cut ───┤
                公寓 → 街道                                           │
```

### 10.1 A 类衔接处理流程

```
1. 生成 SHOT(N) 视频
2. 提取 SHOT(N) 最后一帧（FFmpeg: -vf "select=eq(n\,X)" 取末帧）
3. SHOT(N+1) 生成时将末帧作为 @Image 参考图传入 Seedance
4. 拼接时硬切，不需要转场
```

### 10.2 B 类衔接约束

虽不需要起止帧对齐，但需要在分镜中标注空间一致性约束：
- 角色视线方向
- 屏幕方向（左/右）
- 人物相对位置关系

---

## 11. 已知风险与缓解

| 风险 | 等级 | 已实施的缓解 | 残留风险 |
|------|------|-------------|---------|
| 角色一致性（跨镜头长相漂移） | 中 | 定妆照 + Seedance 多图参考 | 脸部微小漂移（耳廓形状、眉形细节），需实测量化 |
| 多角色同框 | 高 | Seedance 多图参考（每人定妆照） | 模型同时保持 3+ 张脸的稳定性未验证 |
| 运动连续性（A 类衔接） | 中 | 起止帧对齐 | 起止帧间跨度大时中间帧可能崩，需控制单镜动作幅度 |
| 镜头时长不可控 | 低 | 后期变速 ±10% 微调 | 超出 ±10% 误差的极端情况需人工裁决 |
| 画面质感漂移 | 中 | 后期统一调色（3D LUT） | 噪点分布、锐度、纹理密度等无法用 LUT 修正 |
| Seedance 原生音频质量 | 中 | 方案 B（TTS + Wav2Lip）作为备选 | 需实测原生音频后评估是否需要切换 |
| 角色声音一致性 | 中 | TTS 方案中为每角色创建固定声音配置文件 | Seedance 原生方案中跨生成声音一致性无保证 |
| 叙事节奏平 | 中 | 分镜 Prompt 植入节奏规则；分镜序列可人工调 | 好节奏依赖人工审美判断，AI 只能保底不出错 |
| 生成质量不稳定（抽卡） | 中 | 每镜头生成 2-3 条候选，自动+人工选优 | 坏运气下全部候选不达标，需重生成 |
| 成本控制 | 低 | 按需控制定妆照数量、候选条数 | 长片（>30min）的 API 调用量需预算规划 |

---

## 12. 附录：全部 Prompt 模板

### A1. DeepSeek 分镜 System Prompt

```
你是一位资深电影分镜师和导演。你的任务是将中文剧本转换为可执行的分镜脚本，
供 AI 视频生成模型使用。

## 你的知识体系

你需要运用以下电影专业知识：

### 景别（Shot Size）
- ELS（极远景）：环境为主，人物很小或不存在
- WS（全景）：人物全身可见，展示人物与环境的关系
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
- 低角度（Low Angle）：角色显得强大、有压迫感或威胁感
- 高角度（High Angle）：角色显得弱小、脆弱或被压制
- 过肩（Over-the-shoulder）：对话场景的标准机位
- 俯拍（Overhead/Top-down）：抽离感、上帝视角
- 荷兰角（Dutch Angle）：不安、失衡、异常

### 运镜
- 固定（Locked-off）：最常用，画面稳定
- 缓推（Slow Push-in）：逐步接近，增强情感强度或关注
- 缓拉（Slow Pull-out）：逐步远离，揭示更大语境或孤独感
- 跟拍（Tracking）：跟随角色移动，保持构图
- 手持（Handheld）：轻微晃动，真实感、紧张、纪录片风格
- 摇镜（Pan）：水平旋转，建立空间关系或跟随视线

### 180 度规则和轴线
对话场景中，两个角色之间有一条假想的"轴线"。所有机位必须在轴线同一侧，
否则角色 A 在画左看右，切镜头后变成在画右看左，观众会困惑。你需要：
- 为每场对话戏定义轴线
- 所有机位保持在轴线同一侧
- 标注每个镜头中角色的屏幕方向和视线方向

### 光线
每个镜头需要定义：
- 主光方向、类型、色温
- 辅光方向和光比
- 光比含义：2:1（亮调/喜剧）、3:1（正常）、4:1 以上（暗调/惊悚）
- 灯光氛围对叙事的作用

### 色彩
- 主导色调和情感关联（暖 = 亲密/怀旧，冷 = 疏离/压抑）
- 饱和度倾向
- 参照的视觉风格（具体电影或摄影师）

### 构图
- 三分法
- 纵深层次（前景/中景/背景）
- 视线引导
- 负空间运用

## 衔接类型

每个镜头必须标注衔接类型：
- A 类（连续动作）：此镜头与前一个镜头是同一角色的连续运动，需要起止帧对齐
- B 类（视角切换）：切换视角或角色，但仍在同一时空中
- C 类（时间跳跃）：时间推进（"一小时后"），前后不连续
- D 类（场景切换）：场景改变

## 输出格式

首先输出【角色字典】和【场景字典】，然后按场景输出【分镜序列】。

每个镜头使用以下模板（不要省略任何字段）：

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
  质感参照：[具体电影/摄影师/胶片类型]

构图
  纵深层次：[前景→中景→背景]
  视觉锚点：[最亮/最吸引视线的区域]
  分割与方向：[画面中的角色位置和屏幕方向]

空间信息
  角色位置与方向：[位置描述 + 面对的朝向]
  屏幕方向：[角色在画左还是画右，视线向左还是向右]
  上镜衔接：[衔接类型对应的衔接说明]
  下镜预留：[为下一个镜头预留的空间/视线信息]

音频
  对白：角色的台词，标注语气（如 "安娜（轻声，犹豫）：我不确定。"）
  音效：[类型 + 大致时间点]
  环境音：[延续场景的环境音]

视频生成 Prompt（正面）
  [英文，详细的画面描述。包含：景别、角度、运镜、角色特征（引用 Image 编号
   如 "see Image1 for face reference"）、动作、光影、色彩、质感、画幅比例。
   注意 prompt 要包含具体的视觉信息，不要写抽象的情绪词。]

视频生成 Prompt（负面）
  [英文，需要排除的元素列表]
```

## 质量要求

1. 每个镜头的 prompt 必须包含足够的具体视觉信息，排除模糊的抽象描述
2. 相邻镜头的空间关系必须自洽（视线方向、位置关系）
3. 对话场景严格遵守 180 度规则
4. 景别序列有意义地变化，避免连续相同景别
5. 光线和色彩在场景内保持一致
6. 角色的外貌描述在整部电影分镜中保持一致（从角色字典引用）
7. Prompt 使用英文（视频模型对英文 prompt 的理解最好）
```

### A2. 角色定妆照 Prompt 模板

用于 SD/Flux/Midjourney 生成角色定妆照。

#### 正面肖像（胸像）

```
Professional character portrait, chest-up. [角色名], [性别], [年龄] years old.
[面部特征：脸型、五官、肤色、标志特征].
[发型发色]. Natural expression, slight [情绪倾向 — 中性/略带忧愁/沉稳] look.
[服装领口可见部分].
Studio lighting: soft key light from 45 degrees left, subtle fill from right,
gentle catchlight in eyes. Neutral dark grey background. Shallow depth of field,
shot on 85mm f/1.4 lens. Photorealistic, 8K, cinematic color grading.
--ar 3:4
```

#### 半侧面（45°）

```
Professional character portrait, 45-degree profile. [角色名], [性别], [年龄] y/o.
[面部特征 — 与正面提示词一致].
[发型发色 — 从侧面看发型的完整形态].
[服装 — 可见上半身到腰部].
[情绪 — 与正面一致但略有变化，增加立体感].
Studio lighting matching previous portrait, consistent color temperature and
contrast ratio. Mid-grey background. Photorealistic, 8K. --ar 3:4
```

#### 全身照

```
Full body standing shot. [角色名], [性别], [年龄] y/o. [外貌特征 — 关键摘要].
[完整服装描述，从上到下，含鞋子].
Standing naturally, relaxed posture, facing slightly off-camera.
[场景提示 — 可置于中性环境中，如 "in a softly lit interior, warm ambient"].
Full body visible from head to toe. Cinematic lighting, Arri Alexa look,
photorealistic, 8K. --ar 2:3
```

### A3. 场景参考图 Prompt 模板

#### 场景主视角（广角）

```
Cinematic wide shot of [场景描述：地点、时间、空间特征].
[光源描述：类型、位置、色温].
[色调和氛围].
[关键物件及其位置].
[窗外/室外可见内容（如适用）].
No characters in frame. Empty room, establishing shot. Architectural Digest
photography style meets Denis Villeneuve film aesthetic. Shot on Arri Alexa 65,
anamorphic lenses. Photorealistic, 8K. --ar 16:9
```

#### 场景关键元素特写（可选）

```
Cinematic close-up detail of [关键物件/区域]，[位置描述].
[光源描述] falling across the surface. [质感描述]. [物件状态描述 — 如 "dust
visible, slightly worn"].
Macro detail, shallow depth of field, cinematic color grading. Photorealistic,
8K. --ar 16:9
```

### A4. 视频生成 Prompt 组装规则

从分镜数据到 Seedance 可用的 prompt 字符串，按以下规则组装：

```
[景别，英文]，[机位，英文]，[运镜，英文].
[角色描述，含 Image 引用标记].
[动作描述].
[场景描述].
[光影描述：主光方向+色温+光比].
[色彩和质感].
[衔接约束（如 "action continues from previous shot's final frame"）].
[构图提示].
[画幅比例：16:9, 1080p, cinematic].
```

引用规则：
- 角色引用格式：`Anna (see Image1 for face reference, Image2 for full outfit)` 或 `Anna (Image1)` 等简化形式
- 场景引用格式：`the apartment living room (see Image3 for setting reference)`
- 起始帧引用格式：`Starting frame matches the provided reference image`

负面 Prompt 通用模板：
```
direct eye contact with camera, breaking the fourth wall, smiling, laughing,
bright daylight, high contrast, oversaturated, cartoon, anime, CGI, 3D render,
smooth digital video, smartphone footage, text, watermark, logo, letterbox bars,
blurry, low quality, distorted face, extra limbs, mutated hands, bad anatomy
```

---

*文档版本：v1.0 | 日期：2026-05-20*
