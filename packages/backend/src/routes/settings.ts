import { Router, Request, Response, IRouter } from 'express'
import { jwtAuth, AuthRequest } from '../middleware/authMiddleware'
import { getSettings, updateSettings } from '../lib/settings'

const router: IRouter = Router()
router.use(jwtAuth)

// Admin-only guard
function requireAdmin(req: AuthRequest, res: Response): boolean {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' })
    return false
  }
  return true
}

// GET /api/admin/settings
router.get('/', (req: Request, res: Response) => {
  if (!requireAdmin(req as AuthRequest, res)) return
  res.json(getSettings())
})

// PUT /api/admin/settings
router.put('/', (req: Request, res: Response) => {
  if (!requireAdmin(req as AuthRequest, res)) return
  const current = getSettings()
  const {
    fallbackOnAnyError,
    fallbackTruncateOnContextExceeded,
    fallbackPenaltyBaseMs,
    fallbackPenaltyMaxMs,
    fallbackPenaltyWeightRatio,
  } = req.body as Record<string, unknown>

  const patch: Record<string, unknown> = {}
  if (typeof fallbackOnAnyError === 'boolean') patch.fallbackOnAnyError = fallbackOnAnyError
  if (typeof fallbackTruncateOnContextExceeded === 'boolean') patch.fallbackTruncateOnContextExceeded = fallbackTruncateOnContextExceeded

  if (fallbackPenaltyBaseMs !== undefined) {
    const n = Number(fallbackPenaltyBaseMs)
    if (!Number.isFinite(n) || n < 1000 || n > 3_600_000) {
      res.status(400).json({ error: 'fallbackPenaltyBaseMs must be between 1000 and 3600000' })
      return
    }
    patch.fallbackPenaltyBaseMs = Math.round(n)
  }

  if (fallbackPenaltyMaxMs !== undefined) {
    const n = Number(fallbackPenaltyMaxMs)
    if (!Number.isFinite(n) || n < 1000 || n > 7_200_000) {
      res.status(400).json({ error: 'fallbackPenaltyMaxMs must be between 1000 and 7200000' })
      return
    }
    patch.fallbackPenaltyMaxMs = Math.round(n)
  }

  const mergedBase = Number(patch.fallbackPenaltyBaseMs ?? current.fallbackPenaltyBaseMs)
  const mergedMax = Number(patch.fallbackPenaltyMaxMs ?? current.fallbackPenaltyMaxMs)
  if (mergedBase > mergedMax) {
    res.status(400).json({ error: 'fallbackPenaltyBaseMs cannot be greater than fallbackPenaltyMaxMs' })
    return
  }

  if (fallbackPenaltyWeightRatio !== undefined) {
    const n = Number(fallbackPenaltyWeightRatio)
    if (!Number.isFinite(n) || n <= 0 || n > 1) {
      res.status(400).json({ error: 'fallbackPenaltyWeightRatio must be in (0, 1]' })
      return
    }
    patch.fallbackPenaltyWeightRatio = Number(n.toFixed(3))
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'No valid fields provided' })
    return
  }
  res.json(updateSettings(patch))
})

export default router
