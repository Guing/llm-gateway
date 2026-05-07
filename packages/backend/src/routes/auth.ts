import { Router, Request, Response, IRouter } from 'express'
import { prisma } from '../lib/prisma'
import { hashPassword, comparePassword, signToken } from '../services/AuthService'

const router: IRouter = Router()

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' })
    return
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' })
    return
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: 'Invalid email format' })
    return
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      res.status(409).json({ error: 'Email already registered' })
      return
    }

    const hashed = await hashPassword(password)
    const user = await prisma.user.create({
      data: { email, password: hashed, role: 'user' },
    })

    const token = signToken({ userId: user.id, email: user.email, role: user.role })
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    })
  } catch {
    res.status(500).json({ error: 'Registration failed' })
  }
})

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' })
    return
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.enabled) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const valid = await comparePassword(password, user.password)
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role })
    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    })
  } catch {
    res.status(500).json({ error: 'Login failed' })
  }
})

export default router
