import { Router, Response, IRouter } from 'express'
import { prisma } from '../lib/prisma'
import { hashPassword } from '../services/AuthService'
import { AuthRequest, jwtAuth, requireAdmin } from '../middleware/authMiddleware'

const router: IRouter = Router()
router.use(jwtAuth, requireAdmin)

// GET /api/admin/users
router.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      role: true,
      enabled: true,
      createdAt: true,
      _count: { select: { apiKeys: true, requestLogs: true } },
    },
  })
  res.json(users)
})

// POST /api/admin/users — Create user
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { email, password, role = 'user' } = req.body
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' })
    return
  }
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }
  const hashed = await hashPassword(password)
  const user = await prisma.user.create({
    data: { email, password: hashed, role },
    select: { id: true, email: true, role: true, enabled: true, createdAt: true },
  })
  res.status(201).json(user)
})

// PATCH /api/admin/users/:id — Update user role/enabled
router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10)
  const { role, enabled, password } = req.body

  const data: Record<string, unknown> = {}
  if (role !== undefined) data.role = role
  if (enabled !== undefined) data.enabled = enabled
  if (password) data.password = await hashPassword(password)

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, role: true, enabled: true },
  })
  res.json(user)
})

// DELETE /api/admin/users/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10)
  // Prevent deleting self
  if (id === req.user!.id) {
    res.status(400).json({ error: 'Cannot delete your own account' })
    return
  }
  await prisma.user.delete({ where: { id } })
  res.json({ message: 'User deleted' })
})

export default router
