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
 * Also accepts: ?token=<jwt> query param (for SSE EventSource connections)
 */
export function jwtAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  // Support ?token= query param for SSE (EventSource cannot set headers)
  const queryToken = req.query.token as string | undefined
  const authHeader = req.headers.authorization
  const rawToken = queryToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)

  if (!rawToken) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' })
    return
  }

  try {
    const payload = verifyToken(rawToken)
    req.user = { ...payload, id: payload.userId }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

/**
 * Gateway API Key authentication middleware.
 * Accepts either:
 *   Authorization: Bearer sk-gw-<key>  (OpenAI-style)
 *   x-api-key: sk-gw-<key>             (Anthropic-style)
 * Looks up hashed key in DB, populates req.user and req.apiKeyRecord.
 */
export async function apiKeyAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization
  const xApiKey = req.headers['x-api-key']

  let key: string | undefined
  if (authHeader?.startsWith('Bearer ')) {
    key = authHeader.slice(7)
  } else if (typeof xApiKey === 'string' && xApiKey.length > 0) {
    key = xApiKey
  }

  if (!key) {
    res.status(401).json({ error: 'Missing Authorization header' })
    return
  }
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
