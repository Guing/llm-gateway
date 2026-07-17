import { Router, Response, IRouter } from 'express'
import fetch from 'node-fetch'
import { prisma } from '../lib/prisma'
import { encrypt, decrypt } from '../lib/crypto'
import { AuthRequest, jwtAuth, requireAdmin } from '../middleware/authMiddleware'

const router: IRouter = Router()
router.use(jwtAuth, requireAdmin)

const SUPPORTED_PROVIDERS = new Set(['openai', 'anthropic', 'custom', 'custom-anthropic', 'ollama'])

function isApiKeyRequired(provider: string): boolean {
  return provider !== 'ollama'
}

export interface ModelRouteAdvancedConfig {
  priority?: number
  weight?: number
  enabled?: boolean
  config?: {
    timeout?: number
    maxRetries?: number
    customHeaders?: Record<string, string>
    maxTokens?: number
    contextLength?: number
  }
}

// Helper: sync ModelRoutes from channel models + aliases + modelTypes + modelAdvanced
async function syncModelRoutes(
  channelId: number,
  models: string[],
  aliases: Record<string, string>,
  modelTypes: Record<string, string[]> = {},
  modelAdvanced: Record<string, ModelRouteAdvancedConfig> = {}
) {
  const existing = await prisma.modelRoute.findMany({ where: { channelId } })
  const existingByActual = new Map(existing.map((r) => [r.actualModel, r]))

  for (const actualModel of models) {
    const virtualModel = aliases[actualModel] || actualModel
    const types = modelTypes[actualModel] ?? []
    const typesJson = JSON.stringify(types)
    const adv = modelAdvanced[actualModel] ?? {}
    const configJson = JSON.stringify(adv.config ?? {})
    const ex = existingByActual.get(actualModel)
    if (ex) {
      const needsUpdate =
        ex.virtualModel !== virtualModel ||
        ex.types !== typesJson ||
        (adv.priority !== undefined && ex.priority !== adv.priority) ||
        (adv.weight !== undefined && ex.weight !== adv.weight) ||
        (adv.enabled !== undefined && ex.enabled !== adv.enabled) ||
        ex.config !== configJson
      if (needsUpdate) {
        await prisma.modelRoute.update({
          where: { id: ex.id },
          data: {
            virtualModel,
            types: typesJson,
            ...(adv.priority !== undefined ? { priority: adv.priority } : {}),
            ...(adv.weight !== undefined ? { weight: adv.weight } : {}),
            ...(adv.enabled !== undefined ? { enabled: adv.enabled } : {}),
            config: configJson,
          },
        })
      }
      existingByActual.delete(actualModel)
    } else {
      // Newest model gets highest priority: max existing priority + 1
      const maxRoute = await prisma.modelRoute.findFirst({
        orderBy: { priority: 'desc' },
      })
      const defaultPriority = maxRoute ? maxRoute.priority + 1 : 1
      await prisma.modelRoute.create({
        data: {
          virtualModel,
          actualModel,
          channelId,
          priority: adv.priority ?? defaultPriority,
          weight: adv.weight ?? 100,
          enabled: adv.enabled ?? true,
          types: typesJson,
          config: configJson,
        },
      })
    }
  }

  // Remove routes for deleted models
  for (const [, route] of existingByActual) {
    await prisma.modelRoute.delete({ where: { id: route.id } })
  }
}

const CHANNEL_SELECT = {
  id: true, name: true, baseUrl: true, provider: true,
  enabled: true, createdAt: true, updatedAt: true,
  models: true, modelAliases: true, modelTypes: true, encryptedKey: true,
  _count: { select: { modelRoutes: true } },
}

function withDecryptedKey<T extends { encryptedKey: string }>(ch: T): Omit<T, 'encryptedKey'> & { apiKey: string } {
  const { encryptedKey, ...rest } = ch
  let apiKey = ''
  try { apiKey = decrypt(encryptedKey) } catch { /* ignore */ }
  return { ...rest, apiKey }
}

const ROUTE_SELECT = {
  id: true, virtualModel: true, actualModel: true,
  priority: true, weight: true, enabled: true, types: true, config: true,
}

// GET /api/admin/channels
router.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  const channels = await prisma.channel.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      ...CHANNEL_SELECT,
      modelRoutes: { select: ROUTE_SELECT, orderBy: [{ virtualModel: 'asc' }, { priority: 'desc' }] },
    },
  })
  res.json(channels.map(withDecryptedKey))
})

// POST /api/admin/channels
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, baseUrl, apiKey, provider = 'openai', models = [], modelAliases = {}, modelTypes = {}, modelAdvanced = {} } = req.body
  if (!name || !baseUrl) {
    res.status(400).json({ error: 'name and baseUrl are required' })
    return
  }
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    res.status(400).json({ error: `Unsupported provider: ${provider}` })
    return
  }
  if (isApiKeyRequired(provider) && !apiKey) {
    res.status(400).json({ error: 'apiKey is required for this provider' })
    return
  }

  const channel = await prisma.channel.create({
    data: {
      name, baseUrl, provider,
      encryptedKey: encrypt(apiKey ?? ''),
      models: JSON.stringify(models),
      modelAliases: JSON.stringify(modelAliases),
      modelTypes: JSON.stringify(modelTypes),
    },
    select: CHANNEL_SELECT,
  })

  if (models.length > 0) {
    await syncModelRoutes(channel.id, models, modelAliases, modelTypes, modelAdvanced)
  }

  const updated = await prisma.channel.findUnique({
    where: { id: channel.id },
    select: { ...CHANNEL_SELECT, modelRoutes: { select: ROUTE_SELECT, orderBy: [{ priority: 'desc' }] } },
  })
  res.status(201).json(updated ? withDecryptedKey(updated) : null)
})

// PUT /api/admin/channels/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10)
  const { name, baseUrl, apiKey, provider, enabled, models, modelAliases, modelTypes, modelAdvanced } = req.body

  if (provider !== undefined && !SUPPORTED_PROVIDERS.has(provider)) {
    res.status(400).json({ error: `Unsupported provider: ${provider}` })
    return
  }

  const current = await prisma.channel.findUnique({ where: { id } })
  if (!current) {
    res.status(404).json({ error: 'Channel not found' })
    return
  }

  const targetProvider = provider ?? current.provider
  let currentApiKey = ''
  try { currentApiKey = decrypt(current.encryptedKey) } catch { /* validated below */ }
  if (isApiKeyRequired(targetProvider) && !apiKey && !currentApiKey) {
    res.status(400).json({ error: 'apiKey is required for this provider' })
    return
  }

  const data: Record<string, unknown> = {}
  if (name !== undefined) data.name = name
  if (baseUrl !== undefined) data.baseUrl = baseUrl
  if (provider !== undefined) data.provider = provider
  if (enabled !== undefined) data.enabled = enabled
  if (apiKey) data.encryptedKey = encrypt(apiKey)
  if (models !== undefined) data.models = JSON.stringify(models)
  if (modelAliases !== undefined) data.modelAliases = JSON.stringify(modelAliases)
  if (modelTypes !== undefined) data.modelTypes = JSON.stringify(modelTypes)

  await prisma.channel.update({ where: { id }, data })

  if (models !== undefined || modelAliases !== undefined || modelTypes !== undefined || modelAdvanced !== undefined) {
    const ch = await prisma.channel.findUnique({ where: { id } })
    if (ch) {
      const m: string[] = models !== undefined ? models : JSON.parse(ch.models || '[]')
      const a: Record<string, string> = modelAliases !== undefined ? modelAliases : JSON.parse(ch.modelAliases || '{}')
      const t: Record<string, string[]> = modelTypes !== undefined ? modelTypes : JSON.parse(ch.modelTypes || '{}')
      const adv: Record<string, ModelRouteAdvancedConfig> = modelAdvanced ?? {}
      await syncModelRoutes(id, m, a, t, adv)
    }
  }

  const updated = await prisma.channel.findUnique({
    where: { id },
    select: { ...CHANNEL_SELECT, modelRoutes: { select: ROUTE_SELECT, orderBy: [{ priority: 'desc' }] } },
  })
  res.json(updated ? withDecryptedKey(updated) : null)
})

// DELETE /api/admin/channels/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10)
  await prisma.channel.delete({ where: { id } })
  res.json({ message: 'Channel deleted' })
})

// POST /api/admin/channels/test — 测试上游连接
router.post('/test', async (req: AuthRequest, res: Response): Promise<void> => {
  const { baseUrl, apiKey, provider, model } = req.body as {
    baseUrl?: string; apiKey?: string; provider?: string; model?: string
  }

  if (provider && !SUPPORTED_PROVIDERS.has(provider)) {
    res.status(400).json({ error: `不支持的渠道类型：${provider}` })
    return
  }

  if (!baseUrl || !provider || !model || (isApiKeyRequired(provider) && !apiKey)) {
    res.status(400).json({ error: '参数不完整，需要 baseUrl、provider、model；非 Ollama 渠道还需要 apiKey' })
    return
  }

  const base = baseUrl.replace(/\/+$/, '')
  const isAnthropic = provider === 'anthropic' || provider === 'custom-anthropic'
  const url = isAnthropic ? `${base}/v1/messages` : `${base}/v1/chat/completions`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isAnthropic) {
    headers['x-api-key'] = apiKey ?? ''
    headers['anthropic-version'] = '2023-06-01'
    // Custom Anthropic-compatible providers may require Authorization: Bearer instead
    // of x-api-key, so send both for custom-anthropic.
    if (provider === 'custom-anthropic') {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
  } else if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
    stream: false,
  })

  const timeoutMs = 15000
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
  )

  try {
    const upstream = await Promise.race([
      fetch(url, { method: 'POST', headers, body }),
      timeoutPromise,
    ])

    const statusCode = upstream.status
    let success: boolean
    let message: string

    if (statusCode >= 200 && statusCode < 300) {
      success = true
      message = '连接成功'
    } else {
      success = false
      if (statusCode === 401) {
        message = 'API Key 无效（401 Unauthorized）'
      } else if (statusCode === 403) {
        message = '权限不足（403 Forbidden）'
      } else if (statusCode === 404) {
        message = '模型或路径不存在（404 Not Found）'
      } else if (statusCode >= 400 && statusCode < 500) {
        try {
          const errBody = await upstream.json() as { error?: { message?: string } | string }
          const detail = typeof errBody.error === 'object' ? errBody.error?.message : errBody.error
          message = detail ? `请求失败：${detail}` : `上游返回 ${statusCode}`
        } catch {
          message = `上游返回 ${statusCode}`
        }
      } else {
        message = `服务器错误（${statusCode}）`
      }
    }

    res.json({ success, message, statusCode })
  } catch (err: unknown) {
    const e = err as { message?: string }
    if (e.message === 'TIMEOUT') {
      res.json({ success: false, message: '请求超时（15s）' })
    } else {
      res.json({ success: false, message: `连接失败：${e.message ?? '未知错误'}` })
    }
  }
})

export default router
