# TokenVoke 主流程 vs 测试脚本对比 — 参数差异分析

对比对象：`src/step3_video_generation.py:TokenVokeProvider` ↔ `scripts/test_tokenvoke_i2v.py` / `scripts/test_stepfun_i2v.py`

---

## 1. 🚨 图片托管方式（致命错误）

**Pipeline (`_local_to_public_url`, line 253-269)：**
```python
return f"{self._public_url}/pipelines/{self._pipeline_id}/artifacts/{rel}"
```
→ Go server 保存文件为 `script.txt`，**始终返回 `text/plain`**
→ Seedance 拒绝：`content_type_unsupported`

**测试脚本：**
```python
# Python http.server 直接托管，正确 MIME type
python3 -m http.server 8088
ufo pub :8088
f"{TUNNEL_URL}/{rel_path_from_project_root}"
```
→ `Content-Type: image/jpeg` ✅

**影响：** 所有 i2v 生成必定失败，`_local_to_public_url()` 不可用。

**根因：** `_local_to_public_url()` 依赖 Go server 的 artifacts 端点，但该端点不保留原始 Content-Type。

---

## 2. 🚨 硬编码 `"cinematic"` 触发内容审核

**`src/prompts.py:208`（`assemble_video_prompt` 末尾）：**
```python
parts.append("16:9, 1080p, cinematic.")
```

**测试脚本：**
```python
# 成功通过审核的 prompt
"green grass"
"a kitten looking up and blinking, ears twitching"
```

**影响：** 每次调用 `assemble_video_prompt()` 都会在 prompt 末尾追加 `cinematic`，必然触发 Seedance 内容审核。

**注意：** 即使主路径使用 `.md` 文件（line 515），`.md` 中的 `positive_prompt` 由 DeepSeek 生成，同样包含大量电影术语（景别/运镜/光比等），也可能触发审核。

---

## 3. 🚨 `.md` 文件作为 prompt 主路径

**Pipeline (line 515-517)：**
```python
prompt = self._read_shot_md(shot_id)   # 读取 output/shots/{shot_id}/{shot_id}.md
if not prompt:
    prompt = assemble_video_prompt(shot)  # 降级使用字段拼接
```

Step 1 生成的 `.md` 文件包含 `positive_prompt`，用中文写且包含：
- 景别描述（特写/中景/全景）
- 运镜描述（缓推/跟拍/摇镜）
- 光影/色彩/质感描述
- 这些内容经 Seedance 审核时可能被拦截

**测试脚本：** 手动编写极简英文 prompt，主动避开敏感词。

---

## 4. ⚠️ Duration 类型转换丢失精度

**Pipeline (line 121)：**
```python
"duration": self._normalize_duration(int(duration))
# int(7.8) → 7，不是 8
```

**测试脚本：** 直接写 `4`，无此问题。

**影响：** Step 1 生成的 `duration_sec` 可能是 float（如 7.8），`int()` 直接截断，不是四舍五入。应改为 `round(duration)`。

---

## 5. ⚠️ 无最大轮询超时

**Pipeline (line 171-237)：**
```python
while True:           # 无限循环，没有 max_poll_time
    await asyncio.sleep(5)
    ...
    # 只有 FAILURE 状态才退出
```

**测试脚本：** 同样问题，但测试无大碍。

**影响：** 如果 Seedance 任务卡在 `IN_PROGRESS 50%` 不返回 FAILURE，会永久轮询。建议加 `max_poll_seconds` 兜底。

---

## 6. ⚠️ Start frame 文件后缀硬编码

**`_resolve_image_refs` (line 590)：**
```python
sf_path = str(ensure_output_dir("shots", shot_id) / f"{shot_id}_startframe.png")
```

Step 1 实际生成的是 `{shot_id}_startframe.jpg`（AGENTS.md 确认），`_startframe.png` 不存在，导致 `sf_path` 始终为空。

**影响：** Transition Type A 的连续性帧不会被传入（尽管 start_frame_path 为空，会走 ref_image_paths 的 fallback，但 A 类的**前一镜的 start frame** 是单独加的，见 line 618-621，同样硬编码 `.png`）。

**范围：** `_resolve_image_refs` 全部 3 处 `.png` 硬编码（line 590, 619, 加上 _startframe.md 的检查路径）都应该是 `.jpg`。

---

## 7. ✅ 一致的部分

| 特性 | Pipeline | 测试脚本 | 结论 |
|------|----------|----------|------|
| API endpoint | `POST /v1/video/generations` | 相同 | ✅ |
| Headers | `Bearer {VIDEO_API_KEY}` | 相同 | ✅ |
| 请求体结构 | `{model, prompt, duration, metadata, images}` | 相同 | ✅ |
| 轮询间隔 | 5s | 相同 | ✅ |
| 轮询响应解析 | `data.status`, `data.result_url` | 相同 | ✅ |
| Duration 范围 | clamp [4, 10] | 手动设 4 | ✅ |
| 失败状态检测 | FAILURE/FAILED/EXPIRED/CANCELLED | 相同 | ✅ |

---

## 总结：必须修复的问题

| 优先级 | 问题 | 位置 | 修复方案 |
|--------|------|------|----------|
| 🔴 P0 | 图片托管 Content-Type 错误 | `step3_video_generation.py:253-269` | 改用 Python http.server + tunnel 或修改 Go server 返回正确 Content-Type |
| 🔴 P0 | 硬编码 `"cinematic"` | `prompts.py:208` | 删除该行，或根据内容类型条件添加 |
| 🟡 P1 | Start frame `.png` vs `.jpg` | `step3_video_generation.py:590,619` | 改为 `.jpg` 或同时检查两种后缀 |
| 🟡 P1 | Duration 截断 | `step3_video_generation.py:121,330` | `int(duration)` → `round(duration)` |
| 🟢 P2 | 无轮询超时 | `step3_video_generation.py:171` | 增加 `max_poll_seconds` 兜底 |
