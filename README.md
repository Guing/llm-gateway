# LLM Gateway

一个自托管的 LLM API 网关，兼容 OpenAI、Anthropic 及 OpenAI Responses 接口格式，支持多渠道管理、优先级路由、健康惩罚机制、自动故障转移和完整的对话日志记录。

## 功能特性

### 多格式兼容
- **三格式兼容**：同时支持 OpenAI Chat Completions（`/v1/chat/completions`）、Anthropic Messages（`/v1/messages`）和 OpenAI Responses（`/v1/responses`）接口，内部自动互转
- **Tool/Function 支持**：统一处理 OpenAI Chat、Responses 及 legacy `functions` 三种工具定义格式，自动规范化并转换

### 多渠道管理
- **多提供商支持**：可配置 OpenAI、Anthropic、Ollama、自定义 OpenAI 兼容、自定义 Anthropic 兼容渠道
- **API Key 加密存储**：上游 API Key 以 AES-256-GCM 加密存储，12 字节随机 IV + 16 字节认证标签
- **渠道连通性测试**：管理界面可一键测试渠道连通性
- **渠道批量导入/导出**：支持 JSON 格式的渠道配置导出与批量导入

### 智能路由
- **虚拟模型映射**：客户端使用虚拟模型名，网关透明转换为上游真实模型名
- **模型能力标签**：为路由标注能力类型（`chat`、`vision`、`function-calling`、`reasoning`、`embedding`、`image-generation`、`audio`、`video-generation`）
- **优先级 + 权重选择**：数值越大的路由优先尝试，同优先级内按权重随机分配流量
- **路由级配置**：每条路由可独立设置超时时间、最大重试次数、自定义请求头、最大 Token 及上下文长度

### 健康惩罚与自动故障转移
- **指数退避惩罚**：路由连续失败时自动施加惩罚（`base × 2^(failures-1)`），惩罚期间按比例降低权重
- **惩罚参数可配置**：基础惩罚时长、最大惩罚时长、惩罚期间权重比例均可在管理界面动态调整
- **故障转移触发条件**：429 限速、超时、连接失败（ECONNREFUSED/ECONNRESET）、5xx 错误、配额耗尽等
- **能力降级回退**：当上游拒绝 vision / function-calling / reasoning 等能力时，自动剥离对应参数后重试
- **上下文长度超限处理**：超限时自动截断历史消息（保持消息组完整性），或回退到上下文窗口更大的路由
- **任意错误回退模式**：可配置 `fallbackOnAnyError` 将所有错误均视为可重试

### 流式响应
- **完整 SSE 支持**：透传 Server-Sent Events 流式响应
- **流格式自动检测与转换**：实时识别上游流格式（OpenAI / Anthropic），按需转换后转发给客户端
- **流拦截积累**：`StreamInterceptor` 实时提取 Token 用量、函数调用信息，并在流结束后记录完整日志
- **流开始探测**：在提交路由之前验证连接成功（处理"200 OK 后立即断流"情况）

### 对话日志
- **完整请求记录**：记录用户 ID、API Key、渠道、虚拟/真实模型名、完整请求与响应体、耗时、Token 用量、HTTP 状态码
- **可视化对话界面**：气泡式对话展示，支持多模态图片内容
- **高级筛选**：按用户、虚拟/真实模型名、渠道、日期范围过滤，分页展示
- **对话导出**：支持导出为 CSV、TXT、Markdown 格式

### 分析统计
- **数据总览**：请求总量、成功/错误数、错误率、Token 用量、平均响应时间
- **请求趋势**：可自定义日期范围（7 / 14 / 30 / 60 / 90 天或自定义）的每日请求量图表
- **Token 分析**：每日 Prompt/Completion Token 分布、按模型 Top 30 Token 占比、按用户 Top 10 消耗
- **性能监控**：每日平均/最大响应时间趋势、各渠道请求分布与错误率
- **错误分析**：每日错误率趋势、错误类型分布、高频错误消息

### 用户与 API Key 管理
- **多用户体系**：支持管理员与普通用户双角色，管理员可启用/禁用账户及修改角色
- **API Key 安全**：`sk-gw-` 前缀，密码学随机生成，SHA-256 哈希存储，AES-256-GCM 加密备份
- **双认证头**：同时支持 `Authorization: Bearer sk-gw-...`（OpenAI 风格）和 `x-api-key: sk-gw-...`（Anthropic 风格）

### 系统日志
- **文件日志**：按天滚动写入，保留 30 天，路径可配置
- **实时日志流**：SSE 接口 `/api/admin/system-logs/stream` 支持实时 tail 查看
- **日志过滤**：按日期、级别（INFO / WARN / ERROR / DEBUG）、关键词过滤，支持自动刷新

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
| `DATA_DIR` | `/data`（容器）/ `./data`（本地） | 设置文件存储目录 |
| `LOG_VERBOSE` | `false` | 设为 `true` 时将完整上游请求体写入日志（调试用，生产慎用） |
| `SSE_MIRROR_DEBUG` | `false` | 设为 `true` 时在控制台镜像输出 SSE 数据摘要（调试用） |
| `SSE_MIRROR_MAX_LINES` | `20` | `SSE_MIRROR_DEBUG` 开启时每次请求最多镜像行数 |
| `STREAM_FORMAT_DEBUG` | `false` | 设为 `true` 时记录检测到的流格式（调试用） |
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

在 Web 管理界面 → **API Keys** → 创建新 Key，复制以 `sk-gw-` 开头的完整密钥（仅在创建时显示一次）。

### 调用示例（OpenAI Chat Completions 格式）

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

### 调用示例（OpenAI Responses 格式）

```bash
curl http://localhost:7500/v1/responses \
  -H "Authorization: Bearer sk-gw-xxxxxxxx..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "input": [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "你好"}]}]
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
- **API Key**：上游密钥，AES-256-GCM 加密存储；本地 Ollama 可留空
- **Provider**：`openai` / `anthropic` / `ollama` / `custom` / `custom-anthropic`
- **模型列表**：该渠道支持的上游模型名

Ollama 渠道填写服务根地址（默认 `http://localhost:11434`）和已通过 `ollama pull` 下载的模型名即可。网关通过 Ollama 的 OpenAI 兼容接口 `/v1/chat/completions` 转发请求。
使用 Docker Compose 部署网关、而 Ollama 运行在宿主机时，Base URL 请填写 `http://host.docker.internal:11434`。

### 模型路由（Model Route）

将虚拟模型名映射到渠道的实际模型：

| 字段 | 说明 |
|------|------|
| 虚拟模型 | 客户端请求时使用的模型名，如 `gpt-4o` |
| 实际模型 | 转发给上游的模型名，如 `qwen-max` |
| 渠道 | 选择使用哪个渠道 |
| 优先级 | 数值越大越优先；同优先级按权重随机选择 |
| 权重 | 1–100，同优先级内按比例随机分配流量 |
| 能力标签 | 该路由支持的模型能力（vision、function-calling、reasoning 等） |
| 路由配置 | 超时、最大重试、自定义请求头、上下文长度等高级参数 |

**故障转移逻辑**：请求先选最高优先级渠道，若遇到错误（429 / 超时 / 连接失败 / 能力拒绝等），自动施加退避惩罚并降级到下一候选，直到所有候选全部失败。

### 动态故障转移设置

以下参数无需重启即可在管理界面动态调整：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `fallbackOnAnyError` | `false` | 所有错误均触发故障转移 |
| `fallbackTruncateOnContextExceeded` | `false` | 上下文超限时自动截断消息历史 |
| `fallbackPenaltyBaseMs` | `5000` | 基础惩罚时长（毫秒） |
| `fallbackPenaltyMaxMs` | `300000` | 最大惩罚时长（毫秒） |
| `fallbackPenaltyWeightRatio` | `10` | 惩罚期间权重缩减比例（%） |

## 项目结构

```
llm-gateway/
├── packages/
│   ├── backend/                 # Express + TypeScript 后端
│   │   ├── src/
│   │   │   ├── routes/          # API 路由（auth, gateway, logs, analytics, settings, ...）
│   │   │   ├── services/        # 核心逻辑（路由、代理、流拦截、认证）
│   │   │   ├── middleware/      # JWT / API Key 认证中间件
│   │   │   └── lib/             # Prisma 客户端、加密、日志、能力矩阵、设置
│   │   └── prisma/              # 数据库 schema + 迁移
│   └── frontend/                # Vue 3 + Vite 前端
│       └── src/
│           ├── views/           # 页面组件（Dashboard, Channels, Logs, Analytics, SystemLogs, ...）
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
