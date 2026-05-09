import fs from 'fs'
import path from 'path'
import { Router, Response, IRouter } from 'express'
import { AuthRequest, jwtAuth, requireAdmin } from '../middleware/authMiddleware'

const router: IRouter = Router()
router.use(jwtAuth)
router.use((req: AuthRequest, res: Response, next: () => void) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' })
    return
  }
  next()
})

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs')

/** Return list of available log dates (YYYY-MM-DD), newest first */
router.get('/dates', (_req: AuthRequest, res: Response): void => {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      res.json([])
      return
    }
    const files = fs
      .readdirSync(LOG_DIR)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .map((f) => f.replace('.log', ''))
      .sort()
      .reverse()
    res.json(files)
  } catch {
    res.status(500).json({ error: 'Failed to list log files' })
  }
})

/**
 * GET /api/admin/system-logs?date=YYYY-MM-DD&level=INFO&keyword=xxx&tail=500
 * Returns up to `tail` (default 500, max 5000) lines from the specified date's log file.
 * Optionally filters by level and/or keyword (case-insensitive).
 */
router.get('/', (req: AuthRequest, res: Response): void => {
  try {
    const date = (req.query.date as string) || getTodayStr()
    const level = (req.query.level as string || '').toUpperCase()
    const keyword = (req.query.keyword as string || '').toLowerCase()
    const tail = Math.min(parseInt(req.query.tail as string || '500', 10), 5000)

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD' })
      return
    }

    const logFile = path.join(LOG_DIR, `${date}.log`)

    if (!fs.existsSync(logFile)) {
      res.json({ lines: [], total: 0, date })
      return
    }

    const raw = fs.readFileSync(logFile, 'utf-8')
    let lines = raw.split('\n').filter((l) => l.trim() !== '')

    // Filter by level
    if (level && level !== 'ALL') {
      lines = lines.filter((l) => l.includes(`[${level}`))
    }

    // Filter by keyword
    if (keyword) {
      lines = lines.filter((l) => l.toLowerCase().includes(keyword))
    }

    const total = lines.length
    // Return last `tail` lines
    const sliced = lines.slice(-tail)

    res.json({ lines: sliced, total, date })
  } catch {
    res.status(500).json({ error: 'Failed to read log file' })
  }
})

/**
 * GET /api/admin/system-logs/stream?date=YYYY-MM-DD
 * SSE endpoint: streams new lines appended to today's log file in real time.
 */
router.get('/stream', (req: AuthRequest, res: Response): void => {
  const date = (req.query.date as string) || getTodayStr()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Invalid date format' })
    return
  }

  const logFile = path.join(LOG_DIR, `${date}.log`)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Track current file size so we only send new bytes
  let offset = 0
  try {
    if (fs.existsSync(logFile)) {
      offset = fs.statSync(logFile).size
    }
  } catch { /* ignore */ }

  const POLL_MS = 1000
  const timer = setInterval(() => {
    try {
      if (!fs.existsSync(logFile)) return
      const stat = fs.statSync(logFile)
      if (stat.size <= offset) return

      // Read only the new bytes
      const fd = fs.openSync(logFile, 'r')
      const buf = Buffer.alloc(stat.size - offset)
      fs.readSync(fd, buf, 0, buf.length, offset)
      fs.closeSync(fd)
      offset = stat.size

      const newLines = buf.toString('utf-8').split('\n').filter((l) => l.trim() !== '')
      for (const line of newLines) {
        res.write(`data: ${JSON.stringify(line)}\n\n`)
      }
    } catch { /* ignore read errors */ }
  }, POLL_MS)

  // Send heartbeat every 15 s to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n')
  }, 15000)

  req.on('close', () => {
    clearInterval(timer)
    clearInterval(heartbeat)
  })
})

function getTodayStr(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export default router
