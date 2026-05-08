import { Router, Response, IRouter } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, jwtAuth, requireAdmin } from '../middleware/authMiddleware'

const router: IRouter = Router()
router.use(jwtAuth)

// GET /api/logs — Paginated logs (admin sees all, user sees own)
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const page = parseInt(req.query.page as string || '1', 10)
  const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100)
  const skip = (page - 1) * limit

  const { userId, virtualModel, startDate, endDate } = req.query

  const where: Record<string, unknown> = {}

  // Non-admin users can only see their own logs
  if (req.user!.role !== 'admin') {
    where.userId = req.user!.id
  } else if (userId) {
    where.userId = parseInt(userId as string, 10)
  }

  if (virtualModel) where.virtualModel = virtualModel
  if (startDate || endDate) {
    where.requestedAt = {
      ...(startDate ? { gte: new Date(startDate as string) } : {}),
      ...(endDate ? { lte: new Date(endDate as string) } : {}),
    }
  }

  const [total, logs] = await Promise.all([
    prisma.requestLog.count({ where }),
    prisma.requestLog.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        userId: true,
        channelId: true,
        virtualModel: true,
        actualModel: true,
        requestedAt: true,
        completedAt: true,
        duration: true,
        promptTokens: true,
        completionTokens: true,
        statusCode: true,
        isStreaming: true,
        errorMessage: true,
        user: { select: { email: true } },
        channel: { select: { name: true } },
      },
    }),
  ])

  res.json({
    data: logs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
})

// GET /api/logs/stats — Basic stats (admin only)
router.get('/stats', requireAdminInline, async (req: AuthRequest, res: Response): Promise<void> => {
  const [totalRequests, totalUsers, activeChannels, recentErrors] = await Promise.all([
    prisma.requestLog.count(),
    prisma.user.count(),
    prisma.channel.count({ where: { enabled: true } }),
    prisma.requestLog.count({
      where: {
        errorMessage: { not: null },
        requestedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ])
  res.json({ totalRequests, totalUsers, activeChannels, recentErrors })
})

// GET /api/logs/users — Users who have logs (admin only)
router.get('/users', requireAdminInline, async (_req: AuthRequest, res: Response): Promise<void> => {
  const users = await prisma.user.findMany({
    where: { requestLogs: { some: {} } },
    select: {
      id: true,
      email: true,
      _count: { select: { requestLogs: true } },
    },
    orderBy: { email: 'asc' },
  })
  res.json(users)
})

// GET /api/logs/conversation/:userId — Chat-bubble conversation view
router.get('/conversation/:userId', async (req: AuthRequest, res: Response): Promise<void> => {
  const targetUserId = parseInt(req.params.userId, 10)

  // Non-admin can only view own conversation
  if (req.user!.role !== 'admin' && req.user!.id !== targetUserId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const page = parseInt(req.query.page as string || '1', 10)
  const limit = Math.min(parseInt(req.query.limit as string || '30', 10), 100)
  const skip = (page - 1) * limit

  const { virtualModel, startDate, endDate, channelName, actualModel } = req.query

  const where: Record<string, unknown> = { userId: targetUserId }
  if (virtualModel) where.virtualModel = virtualModel
  if (actualModel) where.actualModel = actualModel
  if (channelName) where.channel = { name: channelName as string }
  if (startDate || endDate) {
    where.requestedAt = {
      ...(startDate ? { gte: new Date(startDate as string) } : {}),
      ...(endDate ? { lte: new Date(endDate as string) } : {}),
    }
  }

  const [total, logs] = await Promise.all([
    prisma.requestLog.count({ where }),
    prisma.requestLog.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        virtualModel: true,
        actualModel: true,
        requestBody: true,
        responseBody: true,
        requestedAt: true,
        completedAt: true,
        duration: true,
        promptTokens: true,
        completionTokens: true,
        statusCode: true,
        isStreaming: true,
        errorMessage: true,
        channel: { select: { name: true } },
      },
    }),
  ])

  res.json({
    data: logs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
})

function requireAdminInline(req: AuthRequest, res: Response, next: () => void) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' })
    return
  }
  next()
}

// DELETE /api/logs — Clear logs (admin only; ?userId=x clears single user)
router.delete('/', requireAdminInline, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined
  const where = userId ? { userId } : {}
  const { count } = await prisma.requestLog.deleteMany({ where })
  res.json({ message: `已删除 ${count} 条日志`, count })
})

export default router
