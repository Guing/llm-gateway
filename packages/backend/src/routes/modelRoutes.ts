import { Router, Response, IRouter } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, jwtAuth, requireAdmin } from '../middleware/authMiddleware'
import { getRouteHealthSnapshot } from '../services/RouterService'

const router: IRouter = Router()
router.use(jwtAuth, requireAdmin)

// GET /api/admin/routes
router.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  const routes = await prisma.modelRoute.findMany({
    orderBy: [{ virtualModel: 'asc' }, { priority: 'desc' }],
    include: {
      channel: {
        select: { id: true, name: true, provider: true },
      },
    },
  })
  res.json(routes)
})

// GET /api/admin/routes/health
router.get('/health', async (_req: AuthRequest, res: Response): Promise<void> => {
  const health = getRouteHealthSnapshot()
  res.json(health)
})

// POST /api/admin/routes
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { virtualModel, actualModel, channelId, priority = 1, weight = 100 } = req.body
  if (!virtualModel || !actualModel || !channelId) {
    res.status(400).json({ error: 'virtualModel, actualModel, channelId are required' })
    return
  }

  const route = await prisma.modelRoute.create({
    data: {
      virtualModel,
      actualModel,
      channelId: parseInt(channelId, 10),
      priority: parseInt(priority, 10),
      weight: parseInt(weight, 10),
    },
    include: { channel: { select: { id: true, name: true, provider: true } } },
  })
  res.status(201).json(route)
})

// PUT /api/admin/routes/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10)
  const { virtualModel, actualModel, channelId, priority, weight, enabled } = req.body

  const data: Record<string, unknown> = {}
  if (virtualModel !== undefined) data.virtualModel = virtualModel
  if (actualModel !== undefined) data.actualModel = actualModel
  if (channelId !== undefined) data.channelId = parseInt(channelId, 10)
  if (priority !== undefined) data.priority = parseInt(priority, 10)
  if (weight !== undefined) data.weight = parseInt(weight, 10)
  if (enabled !== undefined) data.enabled = enabled

  const route = await prisma.modelRoute.update({
    where: { id },
    data,
    include: { channel: { select: { id: true, name: true, provider: true } } },
  })
  res.json(route)
})

// DELETE /api/admin/routes/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10)
  await prisma.modelRoute.delete({ where: { id } })
  res.json({ message: 'Route deleted' })
})

export default router
