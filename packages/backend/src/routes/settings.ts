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
  const { fallbackOnAnyError } = req.body as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  if (typeof fallbackOnAnyError === 'boolean') patch.fallbackOnAnyError = fallbackOnAnyError
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'No valid fields provided' })
    return
  }
  res.json(updateSettings(patch))
})

export default router
