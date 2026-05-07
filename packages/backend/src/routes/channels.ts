import { Router, Response, IRouter } from 'express'
import { prisma } from '../lib/prisma'
import { encrypt } from '../lib/crypto'
import { AuthRequest, jwtAuth, requireAdmin } from '../middleware/authMiddleware'

const router: IRouter = Router()
router.use(jwtAuth, requireAdmin)

// GET /api/admin/channels
router.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  const channels = await prisma.channel.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      baseUrl: true,
      provider: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { modelRoutes: true } },
    },
  })
  res.json(channels)
})

// POST /api/admin/channels
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, baseUrl, apiKey, provider = 'openai' } = req.body
  if (!name || !baseUrl || !apiKey) {
    res.status(400).json({ error: 'name, baseUrl, and apiKey are required' })
    return
  }

  const encryptedKey = encrypt(apiKey)
  const channel = await prisma.channel.create({
    data: { name, baseUrl, encryptedKey, provider },
    select: { id: true, name: true, baseUrl: true, provider: true, enabled: true, createdAt: true },
  })
  res.status(201).json(channel)
})

// PUT /api/admin/channels/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10)
  const { name, baseUrl, apiKey, provider, enabled } = req.body

  const data: Record<string, unknown> = {}
  if (name !== undefined) data.name = name
  if (baseUrl !== undefined) data.baseUrl = baseUrl
  if (provider !== undefined) data.provider = provider
  if (enabled !== undefined) data.enabled = enabled
  if (apiKey) data.encryptedKey = encrypt(apiKey)

  const channel = await prisma.channel.update({
    where: { id },
    data,
    select: { id: true, name: true, baseUrl: true, provider: true, enabled: true, updatedAt: true },
  })
  res.json(channel)
})

// DELETE /api/admin/channels/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10)
  await prisma.channel.delete({ where: { id } })
  res.json({ message: 'Channel deleted' })
})

export default router
