# scripts/

HTTP API 测试/演示脚本集。

## 前提

1. 启动 Go 服务器（默认监听 `:8080`）

```bash
go run ./cmd/server/
# 或
go build ./cmd/server/ && ./server
```

2. 确保 `.env` 已配置 API 密钥（`DEEPSEEK_API_KEY` 等）

3. 确保 `test_script.txt` 存在于项目根目录（或通过 `SCRIPT` 环境变量指定其他剧本）

## 脚本

| 脚本 | 用途 |
|------|------|
| `test_api.sh` | 完整端到端演示：创建 pipeline → 逐步触发 → 查询状态 → 列出/下载产物 → 清理 |
| `create.sh` | 上传剧本，创建 pipeline |
| `status.sh` | 查询 pipeline 状态 |
| `step.sh` | 触发单个步骤（1-5） |
| `artifacts.sh` | 列出或下载产物文件 |
| `delete.sh` | 删除 pipeline 并清理文件 |

## 快速开始

```bash
# 完整演示（自动跑完所有步骤）
bash scripts/test_api.sh

# 或分步手动操作
bash scripts/create.sh my_script.txt
bash scripts/step.sh <pipeline_id> 1
bash scripts/status.sh <pipeline_id>
bash scripts/artifacts.sh <pipeline_id>
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BASE` | `http://localhost:8080` | API 服务器地址 |
| `SCRIPT` | `test_script.txt` | 演示用的剧本文件路径 |

示例：

```bash
BASE=https://my-server.com SCRIPT=scripts/animation_test.txt bash scripts/test_api.sh
```

## 完整演示流程

`test_api.sh` 按顺序执行：

1. **Health check** — `GET /health`
2. **Create pipeline** — `POST /pipelines`（上传剧本）
3. **Get status** — `GET /pipelines/{id}`
4. **Step 1** — `POST /pipelines/{id}/steps/1`（分镜生成）
5. **List artifacts** — `GET /pipelines/{id}/artifacts`
6. **Download storyboard** — `GET /pipelines/{id}/artifacts/storyboard.json`
7. **Step 2** — `POST /pipelines/{id}/steps/2`（视觉素材）
8. **Step 3** — `POST /pipelines/{id}/steps/3`（视频生成）
9. **Final status** — `GET /pipelines/{id}`

Step 1-3 会自动轮询等待完成。Step 4-5 需要视频生成服务支持，如果未配置相应 provider 会跳过或失败。

## 单独使用示例

```bash
# 创建
bash scripts/create.sh
# 输出: {"pipeline_id": "178356...", "status": "pending"}

# 查状态
bash scripts/status.sh 1783565566236793000

# 触发步骤
bash scripts/step.sh 1783565566236793000 1

# 列出产物
bash scripts/artifacts.sh 1783565566236793000

# 下载单个文件
bash scripts/artifacts.sh 1783565566236793000 storyboard.json > storyboard.json

# 删除
bash scripts/delete.sh 1783565566236793000
```
