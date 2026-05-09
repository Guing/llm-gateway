# LLM Gateway

一个自托管的 LLM API 网关，兼容 OpenAI 和 Anthropic 接口格式，支持多渠道管理、优先级路由、自动故障转移和完整的对话日志记录。

## 功能特性

- **双格式兼容**：同时支持 OpenAI（`/v1/chat/completions`）和 Anthropic（`/v1/messages`）请求格式，内部自动互转
- **多渠道管理**：配置多个上游 API 提供商（OpenAI、Anthropic、其他兼容服务），API Key AES-256-GCM 加密存储
- **智能路由**：虚拟模型名映射到实际模型，支持按优先级分层 + 同层按权重随机
- **自动故障转移**：遇到 429 限速、配额耗尽、模型不可用等错误时自动切换到下一渠道
- **流式代理**：完整支持 SSE 流式响应（Server-Sent Events）
- **对话日志**：记录所有请求的完整上下文，可按用户/渠道/模型筛选，支持图片消息显示
- **用户与 API Key 管理**：多用户体系，每个用户可创建多个 API Key
- **管理后台**：Web UI 管理渠道、路由、用户，可视化查看对话历史
- **日志文件**：按天滚动写入文件，保留 30 天，路径可配置

## 技术栈

| 层       | 技术                                         |
| -------- | -------------------------------------------- |
| 后端     | Node.js 22 + Express + TypeScript            |
| ORM      | Prisma 5 + SQLite                            |
| 前端     | Vue 3 + Vite + Element Plus + Tailwind CSS   |
| 包管理   | pnpm 11（monorepo）                          |
| 容器化   | Docker + Docker Compose                      |

## 快速开始

### Docker Compose（推荐）

```bash
# 克隆仓库
git clone <repo-url>
cd llm-gateway

# （可选）复制并修改环境变量
cp .env.example .env  # 或直接编辑 docker-compose.yml 中的 environment

# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f
```

服务启动后访问 `http://localhost:7500`，默认管理员账户：

| 字段 | 默认值 |
|------|--------|
| 邮箱 | `admin@gateway.local` |
| 密码 | `admin123` |

> **生产环境请务必修改** `JWT_SECRET`、`ENCRYPTION_KEY`、`ADMIN_PASSWORD`。

### 本地开发

**前提条件**：Node.js ≥ 22，pnpm ≥ 11

```bash
# 安装依赖
pnpm install

# 初始化数据库（创建 SQLite 文件 + 初始管理员）
pnpm migrate
pnpm seed

# 启动后端（端口 7500，热重载）
pnpm dev:backend

# 启动前端（端口 5173，热重载）
pnpm dev:frontend
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `7500` | 后端监听端口 |
| `DATABASE_URL` | `file:/data/prod.db` | Prisma SQLite 路径 |
| `JWT_SECRET` | `change-me-in-production` | JWT 签名密钥 |
| `ENCRYPTION_KEY` | `000...0`（64位十六进制） | AES-256-GCM 加密渠道 API Key 的密钥 |
| `LOG_DIR` | `/logs`（容器）/ `./logs`（本地） | 日志文件目录 |
| `LOG_VERBOSE` | `false` | 设为 `true` 时将完整上游请求体写入日志（调试用，生产慎用） |
| `CORS_ORIGIN` | `http://localhost:5173,...` | 允许的 CORS 来源，逗号分隔 |
| `ADMIN_EMAIL` | `admin@gateway.local` | 首次启动时创建的管理员邮箱 |
| `ADMIN_PASSWORD` | `admin123` | 首次启动时创建的管理员密码 |

> `ENCRYPTION_KEY` 必须为 64 位十六进制字符串（256 位随机密钥），可用以下命令生成：
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

## 数据持久化

Docker Compose 默认使用具名 volume：

| Volume | 容器路径 | 说明 |
|--------|----------|------|
| `app_data` | `/data` | SQLite 数据库 |
| `app_logs` | `/logs` | 日志文件 |

如需挂载到宿主机目录，在 `docker-compose.yml` 中修改为：

```yaml
volumes:
  - ./data:/data
  - ./logs:/logs
```

## API 使用

### 获取 API Key

在 Web 管理界面 → **API Keys** → 创建新 Key，复制以 `sk-gw-` 开头的完整密钥。

### 调用示例（OpenAI 格式）

```bash
curl http://localhost:7500/v1/chat/completions \
  -H "Authorization: Bearer sk-gw-xxxxxxxx..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

### 调用示例（Anthropic 格式）

```bash
curl http://localhost:7500/v1/messages \
  -H "x-api-key: sk-gw-xxxxxxxx..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

### 与第三方客户端集成

只需将客户端的 `base_url` / `api_base` 改为网关地址，`api_key` 改为 Gateway API Key 即可：

| 客户端 | 配置项 | 值 |
|--------|--------|----|
| OpenAI Python SDK | `base_url` | `http://your-host:7500/v1` |
| Anthropic Python SDK | `base_url` | `http://your-host:7500` |
| ChatBox / LobeChat | API 地址 | `http://your-host:7500/v1` |

## 路由配置

### 渠道（Channel）

渠道代表一个上游 API 提供商：

- **名称**：管理界面显示名
- **Base URL**：上游 API 地址（如 `https://api.openai.com`）
- **API Key**：上游密钥，加密存储
- **Provider**：`openai` / `anthropic` / `custom` / `custom-anthropic`
- **模型列表**：该渠道支持的上游模型名

### 模型路由（Model Route）

将虚拟模型名映射到渠道的实际模型：

| 字段 | 说明 |
|------|------|
| 虚拟模型 | 客户端请求时使用的模型名，如 `gpt-4o` |
| 实际模型 | 转发给上游的模型名，如 `qwen-max` |
| 渠道 | 选择使用哪个渠道 |
| 优先级 | 数值越大越优先；同优先级按权重随机选择 |
| 权重 | 1–100，同优先级内按比例随机分配流量 |

**故障转移逻辑**：请求先选最高优先级渠道，若遇到 `429`/`quota`/`overloaded` 等错误，自动降级到下一优先级渠道，直到所有候选全部失败。

## 项目结构

```
llm-gateway/
├── packages/
│   ├── backend/                 # Express + TypeScript 后端
│   │   ├── src/
│   │   │   ├── routes/          # API 路由（auth, gateway, logs, ...）
│   │   │   ├── services/        # 核心逻辑（路由、代理、流拦截）
│   │   │   ├── middleware/      # JWT / API Key 认证中间件
│   │   │   └── lib/             # Prisma 客户端、加密、日志
│   │   └── prisma/              # 数据库 schema + 迁移
│   └── frontend/                # Vue 3 + Vite 前端
│       └── src/
│           ├── views/           # 页面组件（Dashboard, Channels, Logs, ...）
│           └── stores/          # Pinia 状态管理
├── Dockerfile                   # 多阶段构建
├── docker-compose.yml
└── package.json                 # monorepo 根配置
```

## 健康检查

```bash
curl http://localhost:7500/health
# {"status":"ok","env":"production"}
```

## License

MIT
