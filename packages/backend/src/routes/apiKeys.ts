import { Router, Response, IRouter } from 'express'
import { prisma } from '../lib/prisma'
import { generateApiKey, getKeyPrefix, hashApiKey } from '../lib/crypto'
import { AuthRequest, jwtAuth } from '../middleware/authMiddleware'

const router: IRouter = Router()
router.use(jwtAuth)

// GET /api/keys — List current user's API keys
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const keys = await prisma.apiKey.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      enabled: true,
      createdAt: true,
      lastUsedAt: true,
    },
  })
  res.json(keys)
})

// POST /api/keys — Generate a new API key
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { name } = req.body
  if (!name?.trim()) {
    res.status(400).json({ error: 'Key name is required' })
    return
  }

  const plainKey = generateApiKey()
  const keyHash = hashApiKey(plainKey)
  const keyPrefix = getKeyPrefix(plainKey)

  const apiKey = await prisma.apiKey.create({
    data: {
      userId: req.user!.id,
      name: name.trim(),
      keyHash,
      keyPrefix,
    },
  })

  // Return the plaintext key ONCE — it will never be shown again
  res.status(201).json({
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    plainKey, // Only returned once
    enabled: apiKey.enabled,
    createdAt: apiKey.createdAt,
  })
})

// DELETE /api/keys/:id — Delete an API key
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10)

  const key = await prisma.apiKey.findFirst({
    where: { id, userId: req.user!.id },
  })
  if (!key) {
    res.status(404).json({ error: 'API key not found' })
    return
  }

  await prisma.apiKey.delete({ where: { id } })
  res.json({ message: 'API key deleted' })
})

// PATCH /api/keys/:id/toggle — Enable/disable an API key
router.patch('/:id/toggle', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10)

  const key = await prisma.apiKey.findFirst({
    where: { id, userId: req.user!.id },
  })
  if (!key) {
    res.status(404).json({ error: 'API key not found' })
    return
  }

  const updated = await prisma.apiKey.update({
    where: { id },
    data: { enabled: !key.enabled },
  })
  res.json({ id: updated.id, enabled: updated.enabled })
})

export default router
