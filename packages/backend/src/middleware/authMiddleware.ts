import { Request, Response, NextFunction } from 'express'
import { verifyToken, JwtPayload } from '../services/AuthService'
import { hashApiKey } from '../lib/crypto'
import { prisma } from '../lib/prisma'

export interface AuthRequest extends Request {
  user?: JwtPayload & { id: number }
  apiKeyRecord?: { id: number; userId: number }
}

/**
 * JWT authentication middleware.
 * Expects: Authorization: Bearer <jwt>
 */
export function jwtAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' })
    return
  }

  const token = authHeader.slice(7)
  try {
    const payload = verifyToken(token)
    req.user = { ...payload, id: payload.userId }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

/**
 * Gateway API Key authentication middleware.
 * Expects: Authorization: Bearer sk-gw-<key>
 * Looks up hashed key in DB, populates req.user and req.apiKeyRecord.
 */
export async function apiKeyAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' })
    return
  }

  const key = authHeader.slice(7)
  if (!key.startsWith('sk-gw-')) {
    res.status(401).json({ error: 'Invalid API key format' })
    return
  }

  const keyHash = hashApiKey(key)

  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: true },
    })

    if (!apiKey || !apiKey.enabled || !apiKey.user.enabled) {
      res.status(401).json({ error: 'Invalid or disabled API key' })
      return
    }

    req.user = {
      userId: apiKey.userId,
      id: apiKey.userId,
      email: apiKey.user.email,
      role: apiKey.user.role,
    }
    req.apiKeyRecord = { id: apiKey.id, userId: apiKey.userId }

    // Update lastUsedAt async (don't await)
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {})

    next()
  } catch {
    res.status(500).json({ error: 'Authentication error' })
  }
}

/**
 * Middleware to require admin role.
 * Must be used AFTER jwtAuth.
 */
export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' })
    return
  }
  next()
}
