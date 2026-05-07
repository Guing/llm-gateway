import { Router, Response, IRouter } from 'express'
import fetch from 'node-fetch'
import { prisma } from '../lib/prisma'
import { encrypt, decrypt } from '../lib/crypto'
import { AuthRequest, jwtAuth, requireAdmin } from '../middleware/authMiddleware'

const router: IRouter = Router()
router.use(jwtAuth, requireAdmin)

// Helper: sync ModelRoutes from channel models + aliases
async function syncModelRoutes(channelId: number, models: string[], aliases: Record<string, string>) {
  const existing = await prisma.modelRoute.findMany({ where: { channelId } })
  const existingByActual = new Map(existing.map((r) => [r.actualModel, r]))

  for (const actualModel of models) {
    const virtualModel = aliases[actualModel] || actualModel
    const ex = existingByActual.get(actualModel)
    if (ex) {
      if (ex.virtualModel !== virtualModel) {
        await prisma.modelRoute.update({ where: { id: ex.id }, data: { virtualModel } })
      }
      existingByActual.delete(actualModel)
    } else {
      // Newest model gets highest priority: max existing priority + 1
      const maxRoute = await prisma.modelRoute.findFirst({
        orderBy: { priority: 'desc' },
      })
      const priority = maxRoute ? maxRoute.priority + 1 : 1
      await prisma.modelRoute.create({
        data: { virtualModel, actualModel, channelId, priority, weight: 100 },
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
  models: true, modelAliases: true, encryptedKey: true,
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
  priority: true, weight: true, enabled: true,
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
  const { name, baseUrl, apiKey, provider = 'openai', models = [], modelAliases = {} } = req.body
  if (!name || !baseUrl || !apiKey) {
    res.status(400).json({ error: 'name, baseUrl, and apiKey are required' })
    return
  }

  const channel = await prisma.channel.create({
    data: {
      name, baseUrl, provider,
      encryptedKey: encrypt(apiKey),
      models: JSON.stringify(models),
      modelAliases: JSON.stringify(modelAliases),
    },
    select: CHANNEL_SELECT,
  })

  if (models.length > 0) {
    await syncModelRoutes(channel.id, models, modelAliases)
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
  const { name, baseUrl, apiKey, provider, enabled, models, modelAliases } = req.body

  const data: Record<string, unknown> = {}
  if (name !== undefined) data.name = name
  if (baseUrl !== undefined) data.baseUrl = baseUrl
  if (provider !== undefined) data.provider = provider
  if (enabled !== undefined) data.enabled = enabled
  if (apiKey) data.encryptedKey = encrypt(apiKey)
  if (models !== undefined) data.models = JSON.stringify(models)
  if (modelAliases !== undefined) data.modelAliases = JSON.stringify(modelAliases)

  await prisma.channel.update({ where: { id }, data })

  if (models !== undefined || modelAliases !== undefined) {
    const ch = await prisma.channel.findUnique({ where: { id } })
    if (ch) {
      const m: string[] = models !== undefined ? models : JSON.parse(ch.models || '[]')
      const a: Record<string, string> = modelAliases !== undefined ? modelAliases : JSON.parse(ch.modelAliases || '{}')
      await syncModelRoutes(id, m, a)
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

  if (!baseUrl || !apiKey || !provider || !model) {
    res.status(400).json({ error: '参数不完整，需要 baseUrl、apiKey、provider、model' })
    return
  }

  const base = baseUrl.replace(/\/+$/, '')
  const isAnthropic = provider === 'anthropic' || provider === 'custom-anthropic'
  const url = isAnthropic ? `${base}/v1/messages` : `${base}/v1/chat/completions`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isAnthropic) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
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
