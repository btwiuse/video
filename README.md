# AI 剧本到电影系统

输入一份中文剧本，输出一部完整的电影短片。全流程 AI 驱动，人工可在分镜阶段介入调整。

## 快速开始

```bash
# 安装依赖
pip install -r requirements.txt

# 配置 API 密钥
cp .env.example .env
# 编辑 .env，填入各服务的 API Key

# 运行全流程
python main.py run test_script.txt
```

输出在 `output/final.mp4`。

## 管线架构

```
剧本 (.txt)
  │
  ▼
Step 1: 分镜生成 (DeepSeek)     → storyboard.json
  │
  ▼
Step 2: 视觉素材 (Flux/Seedream) → manifest.json
  │
  ▼
Step 3: 视频生成 (Seedance 2.0)  → clip_manifest.json
  │
  ▼
Step 4: 音频制作 (ElevenLabs等)  → audio_manifest.json
  │
  ▼
Step 5: 后期合成 (MoviePy/FFmpeg) → final.mp4
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `python main.py run <剧本>` | 全流程：剧本 → 电影 |
| `python main.py storyboard <剧本>` | 仅 Step 1：生成分镜 |
| `python main.py assets <storyboard.json>` | 仅 Step 2：生成视觉素材 |
| `python main.py videos <storyboard.json> <manifest.json>` | 仅 Step 3：生成视频片段 |
| `python main.py audio <storyboard.json> <clips.json>` | 仅 Step 4：生成音频 |
| `python main.py compose <clips.json> [audio.json]` | 仅 Step 5：后期合成 |
| `python main.py summarize <剧本>` | 生成剧本摘要（标题+简介） |
| `python main.py status` | 查看输出目录状态 |

### 常用选项

```bash
# 跳过特定步骤
python main.py run test_script.txt --skip-step 1 --skip-step 2

# 切换输出目录
OUTPUT_DIR=./output_animation python main.py run scripts/animation_test.txt

# 启用 DeepSeek 推理模式（R1，分镜更细腻但更慢）
python main.py storyboard test_script.txt --reasoning

# 带字幕和调色合成
python main.py compose output/clip_manifest.json -s subtitles.srt -l look.cube
```

## 配置

所有配置通过 `.env` 文件管理：

```ini
# DeepSeek（Step 1：分镜）
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-chat                 # V3，快速
DEEPSEEK_REASONING_MODEL=deepseek-reasoner   # R1，深度推理

# 图片生成（Step 2）
IMAGE_PROVIDER=flux                          # flux / seedream / sdxl / comfyui / null
IMAGE_API_KEY=xxx

# 视频生成（Step 3）
VIDEO_PROVIDER=seedance                      # seedance / null
VIDEO_API_KEY=xxx
SEEDANCE_MODEL=doubao-seedance-2-0-fast-260128

# 音频（Step 4）
AUDIO_PROVIDER=elevenlabs                    # elevenlabs / null
AUDIO_API_KEY=xxx

# 输出目录
OUTPUT_DIR=./output
```

### 可用 Provider

**图片生成**（`IMAGE_PROVIDER`）：

| 值 | 引擎 | 特点 |
|----|------|------|
| `flux` | Flux 1.1 Pro (Replicate) | 高质量 |
| `flux-ultra` | Flux 1.1 Pro Ultra | 更高质量，更慢 |
| `sdxl` | SDXL (Replicate) | 快速，成本低 |
| `seedream` | Seedream 5.0 (火山方舟) | 中文原生支持 |
| `comfyui` | ComfyUI 本地 | 需要 GPU |
| `null` | 不调用 API | 仅保存 prompt，测试用 |

**视频生成**（`VIDEO_PROVIDER`）：

| 值 | 引擎 | 特点 |
|----|------|------|
| `seedance` | Seedance 2.0 (火山方舟) | 图生视频 / 多图参考 |
| `null` | 不调用 API | 仅保存 prompt |

**音频生成**（`AUDIO_PROVIDER`）：

| 值 | 引擎 | 特点 |
|----|------|------|
| `elevenlabs` | ElevenLabs TTS | 多语种语音合成 |
| `null` | 不调用 API | 跳过 |

## 分镜数据格式

每个镜头包含以下字段（由 DeepSeek 自动生成）：

| 字段 | 说明 |
|------|------|
| `full_shot_id` | 镜头 ID，如 `SC01_SHOT03` |
| `shot_size` | 景别：ECU / CU / MCU / MS / MLS / LS / ELS |
| `camera_angle` | 机位描述（位置、高度、角度、POV） |
| `camera_move` | 运镜方式 |
| `action_description` | 按秒级时间顺序的动作流程（≥3句） |
| `visual_description` | 画面内容（前景/主体/背景/细节） |
| `lighting_description` | 光影设计（主光/辅光/光比/氛围） |
| `color_description` | 色彩方案（主导色/点缀色/参照） |
| `composition_description` | 构图与纵深 |
| `duration_sec` | 时长（秒） |
| `transition_type` | 衔接类型：A（连续动作）/ B（视角切换）/ C（时间跳跃）/ D（场景切换） |

### 衔接类型

| 类型 | 含义 | 处理方式 |
|------|------|---------|
| A | 连续动作 | 上一镜尾帧传给下一镜做 reference |
| B | 视角切换 | 同一场景、同一时刻，不同机位 |
| C | 时间跳跃 | 同一场景、不同时间 |
| D | 场景切换 | 完全不同的空间和灯光 |

## 输出目录结构

```
output/
├── storyboard.json           # Step 1 产出：完整分镜
├── manifest.json             # Step 2 产出：视觉素材索引
├── clip_manifest.json        # Step 3 产出：视频片段索引
├── audio_manifest.json       # Step 4 产出：音频索引
├── final.mp4                 # Step 5 产出：最终影片
├── characters/               # 角色定妆照 (front/profile/fullbody)
├── scenes/                   # 场景参考图 (wide/detail)
├── shots/
│   ├── SC01_SHOT01/
│   │   ├── SC01_SHOT01.md           # 分镜详情
│   │   ├── SC01_SHOT01_startframe.png  # 首帧图
│   │   ├── SC01_SHOT01.mp4          # 视频片段
│   │   └── deps.json                # 角色/场景依赖
│   ├── SC01_SHOT02/
│   └── ...
└── _debug/                   # DeepSeek 原始响应（调试用）
```

## 工作流技巧

**断点续跑**：管线天然支持。已生成的 `.mp4` / `.png` 等文件会自动跳过，失败的镜头会重试。直接从中断的步骤再跑即可。

**单独重跑某步**：
```bash
# 改了分镜 prompt，重跑 Step 1
python main.py storyboard test_script.txt

# 某个镜头视频生成失败，重跑 Step 3
python main.py videos output/storyboard.json output/manifest.json
```

**分镜后手动调整**：直接编辑 `output/shots/*/SC_XX_SHOTXX.md` 修改画面描述、动作、光影等内容，然后从 Step 3 继续。

## 系统要求

- Python 3.10+
- FFmpeg（视频合成用）
- 网络访问 DeepSeek API、火山方舟、Replicate 等服务

## 技术细节

项目采用 **Provider 抽象模式**：每个生成步骤（图片/视频/音频）定义了抽象基类和工厂函数，添加新引擎只需实现一个子类并注册到 registry dict。

Step 1 使用 4 阶段工具调用流水线：
1. 纯对话提取角色列表 + 场景概览
2. 按角色调用 function calling 生成详细人设
3. 按场景调用 function calling 生成场景详情
4. 循环按镜头调用 function calling，直到 `is_scene_end=true`

DeepSeek thinking 模式默认关闭，可通过 `--reasoning` 标志或 `.env` 中的 `DEEPSEEK_USE_REASONING=true` 启用。

详细设计见 [DESIGN.md](DESIGN.md)。
