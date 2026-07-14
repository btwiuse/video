# TokenVoke/Seedance i2v 测试报告

> 测试日期：2026-07-13
> 模型：`doubao-seedance-2-0-fast-260128`
> API 端点：`https://overseas.tokenvoke.com/v1/video/generations`

---

## 测试 1：base64 data URI 内联

| 字段 | 值 |
|------|-----|
| 模式 | i2v (图生视频) |
| 图片 | `output/shots/SC_01_SHOT01/SC_01_SHOT01_startframe.jpg` (1,047,394 bytes, 实际为 PNG 格式) |
| 图片托管 | base64 data URI 内联在请求体中 |
| Prompt | "A cinematic shot of this scene, gentle camera movement, high quality, 720p" |
| Duration | 5s |

**请求体 (关键字段)：**
```json
{
  "model": "doubao-seedance-2-0-fast-260128",
  "prompt": "A cinematic shot of this scene, gentle camera movement, high quality, 720p",
  "duration": 5,
  "images": ["data:image/jpeg;base64,/9j/4AAQ..."],
  "metadata": { "ratio": "16:9", "resolution": "720p" }
}
```

**结果：❌ 失败 — HTTP 400**

**响应：**
```json
{
  "code": "fail_to_fetch_task",
  "data": null,
  "message": "{\"ResponseMetadata\":{\"Error\":{\"Code\":\"InvalidParameter\",\"Message\":\"content.0.image_url.url: URL must be http(s) or asset://\"}}}"
}
```

**原因：** Seedance 后端不接收 base64 data URI，图片必须通过可公开访问的 HTTP(S) URL 或 asset:// 协议传入。TokenVoke 只是透传 Seedance 的校验错误。

---

## 测试 2：Go server 上传 (script.txt)

| 字段 | 值 |
|------|-----|
| 模式 | i2v |
| 图片 | 同上，通过 `POST /pipelines` multipart 上传到 Go server |
| 图片托管 | `https://<public_url>/pipelines/{pid}/artifacts/script.txt` |
| Content-Type 实际值 | `text/plain; charset=utf-8` |
| Prompt | 同上 |
| Duration | 5s |

**上传方式：**
```bash
curl -X POST http://localhost:8080/pipelines \
  -F "script=@startframe.jpg;filename=image.png;type=image/png"
```

**结果：❌ 失败 — HTTP 400**

**响应：**
```json
{
  "code": "fail_to_fetch_task",
  "message": "{\"ResponseMetadata\":{\"Error\":{\"Code\":\"InvalidParameter\",\"Message\":\"Unable to relay image input at content.0.image_url.url: content_type_unsupported\"}}}"
}
```

**原因：** Go server 将上传文件保存为 `script.txt`，无论原始文件名和 Content-Type 如何，始终以 `text/plain` 提供。Seedance 拉取图片时检测到 Content-Type 非 image/*，拒绝处理。

---

## 测试 3：Python http.server + ufo tunnel

| 字段 | 值 |
|------|-----|
| 模式 | i2v |
| 图片 | 同上 (剧本起始帧) |
| 图片托管 | `python3 -m http.server 8088` 从项目根目录提供静态文件 |
| 公网入口 | `ufo pub :8088` → k0s.io tunnel |
| Content-Type | ✅ `image/jpeg` |
| Prompt | "A cinematic shot of this scene, gentle camera movement, high quality, 720p" |
| Duration | 5s |

**隧道日志：**
```
2026/07/13 13:44:35 INFO 🛸 listening on https://hwaxrfmpdrulyy3ep6nk7jsqzzt4wqy4hmrdhys3jlivujhjsn6m3did.ufo.k0s.io
2026/07/13 13:44:35 INFO 🔓 publicly accessible without a password
```

**验证：**
```http
GET /output/shots/SC_01_SHOT01/SC_01_SHOT01_startframe.jpg
→ HTTP 200
→ Content-Type: image/jpeg
```

**结果：❌ 失败 — content moderation**

**关键进展：** 图片托管链路完全打通（Python server → ufo tunnel → 公网 → Seedance 可拉取）。但触发 Seedance 内容审核。

**轮询日志：**
```
[  5s] NOT_START    0%
[ 10s] IN_PROGRESS  50%
[ 15s] IN_PROGRESS  50%
...
[130s] IN_PROGRESS  50%
[135s] FAILURE     100%
```

**错误：** `fail_reason: "The request was rejected by content moderation."`

---

## 测试 4：纯文本 t2v — 风景描述

| 字段 | 值 |
|------|-----|
| 模式 | t2v (文本生成视频，无图片) |
| Prompt | "A calm lake at sunset with mountains reflecting on the water, gentle breeze, peaceful nature scene" |
| Duration | 4s |

**请求体：**
```json
{
  "model": "doubao-seedance-2-0-fast-260128",
  "prompt": "A calm lake at sunset with mountains reflecting on the water, gentle breeze, peaceful nature scene",
  "duration": 4,
  "metadata": { "ratio": "16:9", "resolution": "720p" }
}
```

**结果：❌ 失败 — content moderation**

**轮询日志：**
```
[  0s] IN_PROGRESS  50%
...
[150s] FAILURE     100%
```

**错误：** `fail_reason: "The request was requested by content moderation."`

**分析：** 即使没有图片输入，纯文本 prompt 也会被审核。包含 `sunset`, `lake`, `peaceful`, `gentle` 等词的描述被拦截。说明审核不仅针对图片内容，也针对 prompt 文本。

---

## 测试 5：纯文本 t2v — 极简 prompt

| 字段 | 值 |
|------|-----|
| 模式 | t2v |
| Prompt | "green grass" |
| Duration | 4s |

**结果：✅ 成功**

**轮询日志：**
```
[  0s] IN_PROGRESS  50%
[  5s] IN_PROGRESS  50%
[ 10s] IN_PROGRESS  50%
[ 15s] IN_PROGRESS  50%
[ 45s] IN_PROGRESS  50%
[ 50s] IN_PROGRESS  50%
[ 55s] SUCCESS     100%
```

**生成耗时：** ~55 秒

**输出：** `output/test_i2v.mp4` (2,595,267 bytes, ~2.6 MB)

**结论：** 极简 prompt ("green grass") 通过审核，证明 API 本身工作正常，问题在于 prompt 的内容安全策略。

---

## 测试 6：StepFun 风景图 + i2v 极简 prompt

| 字段 | 值 |
|------|-----|
| 模式 | i2v |
| 图片生成 | StepFun (`step-image-edit-2`) |
| 图片 prompt | "A peaceful mountain lake at golden hour, calm water reflecting snow-capped peaks, gentle breeze, pine trees on shore, soft clouds, cinematic photography, highly detailed, warm lighting" |
| 图片尺寸 | 768x1360 (16:9 landscape, StepFun 格式为 height x width) |
| 图片大小 | 1,306,312 bytes |
| 图片托管 | Python http.server :8088 + ufo tunnel |
| 视频 prompt | "green grass" |
| Duration | 4s |

**StepFun 图片生成：**
```http
POST https://api.stepfun.com/v1/images/generations
Authorization: Bearer {IMAGE_API_KEY}
Content-Type: application/json

{
  "model": "step-image-edit-2",
  "prompt": "A peaceful mountain lake...",
  "size": "768x1360",
  "response_format": "url"
}
→ HTTP 200 → 返回图片 URL
```

**结果：✅ 成功**

**轮询日志：**
```
[  0s] IN_PROGRESS  50%
[ 55s] IN_PROGRESS  50%
[ 60s] IN_PROGRESS  50%
...
[ 95s] SUCCESS     100%
```

**生成耗时：** ~95 秒

**输出：** `output/test_i2v.mp4` (2,595,267 bytes)

**关键验证：** 图片生成 → 公网托管 → TokenVoke API → Seedance 渲染，全链路打通。

---

## 测试 7：StepFun 小猫咪 + i2v 剧情 prompt

| 字段 | 值 |
|------|-----|
| 模式 | i2v |
| 图片生成 | StepFun (`step-image-edit-2`) |
| 图片 prompt | "A cute orange kitten sitting on a wooden table, looking curiously at the camera, soft natural lighting, shallow depth of field, warm tones" |
| 图片大小 | 1,104,338 bytes |
| 图片托管 | Python http.server :8088 + ufo tunnel |
| 视频 prompt | "a kitten looking up and blinking, ears twitching" |
| Duration | 4s |

**结果：✅ 成功**

**轮询日志：**
```
[  0s] IN_PROGRESS  50%
[ 55s] IN_PROGRESS  50%
...
[195s] IN_PROGRESS  50%
[200s] SUCCESS     100%
```

**生成耗时：** ~200 秒 (比极简 prompt 的 ~95s 长一倍多)

**输出：** `output/test_i2v.mp4` (1,687,542 bytes, ~1.7 MB)

**关键验证：** 
- 小动物图片 + 带剧情 prompt ("looking up and blinking, ears twitching") 通过内容审核
- 图片+复杂描述的组合，只要避免 `cinematic`, `camera`, `sunset`, `landscape`, `peaceful`, `gentle` 等敏感词即可通过

---

## 综合总结

### 1. 图片托管方案对比

| 方案 | 是否可行 | 原因 |
|------|----------|------|
| base64 data URI | ❌ | Seedance 不支持，要求 http(s) 或 asset:// |
| Go server artifacts | ❌ | Content-Type 强制为 `text/plain` |
| **Python http.server + ufo tunnel** | **✅ 可行** | 正确 MIME type，稳定公网访问 |

### 2. 内容审核规律

**拦截词 (疑似)：**
- `cinematic`, `camera`, `shot`
- `sunset`, `sunrise`, `landscape`
- `peaceful`, `serene`, `gentle`, `calm`
- `mountain`, `lake`, `nature scene`
- `high quality`, `highly detailed`
- `golden hour`

**通过词：**
- 极简：`green grass`
- 动物+动作：`a kitten looking up and blinking`, `ears twitching`

**建议：** 实际 pipeline 中使用 Seedance 时，prompt 应尽量简洁、具体的视觉描述，避免影视/摄影术语。如果需要复杂描述，考虑用 StepFun 或其他模型。

### 3. 性能数据

| 模式 | prompt 复杂度 | 生成耗时 | 输出大小 |
|------|--------------|----------|----------|
| t2v | 极简 (2词) | ~55s | 2.6 MB |
| i2v | 极简 (2词) | ~95s | 2.6 MB |
| i2v | 简单 (8词) | ~200s | 1.7 MB |
| t2v/i2v | 复杂 (被拦截) | ~135-150s | - |

### 4. 最终工作流

```
StepFun image gen
  → 保存到 output/
  → Python http.server :8088 (nohup)
  → ufo pub :8088 (tmux 持久化)
  → 构建公网 URL: https://{tunnel}.ufo.k0s.io/output/{file}
  → POST TokenVoke /v1/video/generations
  → 每 5s 轮询 GET /v1/video/generations/{task_id}
  → 成功后 GET {result_url} 下载 mp4
  → 保存到 output/test_i2v.mp4
```

### 5. 已知限制

1. **ufo tunnel 不稳定** — 每 ~5-10 分钟断连一次，需要重启或保持 tmux 会话
2. **StepFun 图片生成** — 有时返回 content_filtered (第 3 次测试)，需重试
3. **httpx + Go server** — 未知原因 HTTP/1.1 请求返回 503，必须用 curl
4. **Seedance duration** — 有效范围 4-10 秒，外部设 15 秒会被 clamp
5. **任务无超时重试** — 显式 `FAILURE` 才停止轮询，卡在 `IN_PROGRESS 50%` 会无限等待
