import { Router, Response, IRouter } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, jwtAuth, requireAdmin } from '../middleware/authMiddleware'

const router: IRouter = Router()
router.use(jwtAuth)
router.use(requireAdmin)

/** Validate and clamp the `days` query param to an allowlist */
function parseDays(raw: unknown): number {
  const n = parseInt(raw as string || '30', 10)
  return [7, 14, 30, 60, 90].includes(n) ? n : 30
}

/**
 * Resolve the effective date range from query params.
 * Priority: startDate/endDate > days (default 30).
 *
 * Prisma stores SQLite DateTime as integer milliseconds (Unix epoch ms).
 * Raw SQL comparisons MUST use integer ms values, not ISO strings.
 * Returns { startMs, endMs } — milliseconds since epoch.
 */
function getDateRange(req: AuthRequest): { startMs: number; endMs: number } {
  const { startDate, endDate } = req.query as Record<string, string | undefined>

  if (startDate || endDate) {
    const start = startDate ? new Date(startDate) : new Date(0)
    const end = endDate ? new Date(endDate) : new Date()

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      const fallbackStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      return { startMs: fallbackStart.getTime(), endMs: Date.now() }
    }

    // Include the full end day (23:59:59.999)
    end.setHours(23, 59, 59, 999)
    return { startMs: start.getTime(), endMs: end.getTime() }
  }

  const days = parseDays(req.query.days)
  const startMs = Date.now() - days * 24 * 60 * 60 * 1000
  return { startMs, endMs: Date.now() }
}

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/overview
// Total requests, total tokens, error count, avg duration
// ---------------------------------------------------------------------------
router.get('/overview', async (req: AuthRequest, res: Response): Promise<void> => {
  const { startMs, endMs } = getDateRange(req)
  const dateFilter = { requestedAt: { gte: new Date(startMs), lte: new Date(endMs) } }

  const [
    totalRequests,
    errorRequests,
    tokenAgg,
    durationAgg,
    totalUsers,
    activeChannels,
  ] = await Promise.all([
    prisma.requestLog.count({ where: dateFilter }),
    prisma.requestLog.count({ where: { ...dateFilter, errorMessage: { not: null } } }),
    prisma.requestLog.aggregate({
      where: dateFilter,
      _sum: { promptTokens: true, completionTokens: true },
    }),
    prisma.requestLog.aggregate({
      _avg: { duration: true },
      where: { ...dateFilter, duration: { not: null } },
    }),
    prisma.user.count(),
    prisma.channel.count({ where: { enabled: true } }),
  ])

  res.json({
    totalRequests,
    errorRequests,
    errorRate: totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0,
    totalPromptTokens: tokenAgg._sum.promptTokens ?? 0,
    totalCompletionTokens: tokenAgg._sum.completionTokens ?? 0,
    totalTokens: (tokenAgg._sum.promptTokens ?? 0) + (tokenAgg._sum.completionTokens ?? 0),
    avgDurationMs: Math.round(durationAgg._avg.duration ?? 0),
    totalUsers,
    activeChannels,
  })
})

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/request-trend?days=30&startDate=&endDate=
// Daily request counts (total, success, error)
// ---------------------------------------------------------------------------
router.get('/request-trend', async (req: AuthRequest, res: Response): Promise<void> => {
  const { startMs, endMs } = getDateRange(req)

  type TrendRow = { day: string; total: bigint; errors: bigint; success: bigint }
  const rows = await prisma.$queryRaw<TrendRow[]>`
    SELECT
      strftime('%Y-%m-%d', datetime(requestedAt/1000, 'unixepoch', 'localtime')) AS day,
      COUNT(*)                                                        AS total,
      SUM(CASE WHEN errorMessage IS NOT NULL THEN 1 ELSE 0 END)      AS errors,
      SUM(CASE WHEN errorMessage IS NULL     THEN 1 ELSE 0 END)      AS success
    FROM RequestLog
    WHERE requestedAt >= ${startMs} AND requestedAt <= ${endMs}
    GROUP BY day
    ORDER BY day ASC
  `

  res.json(
    rows.map((r) => ({
      day: r.day,
      total: Number(r.total),
      errors: Number(r.errors),
      success: Number(r.success),
    }))
  )
})

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/token-trend?days=30&startDate=&endDate=
// Daily token usage (prompt + completion)
// ---------------------------------------------------------------------------
router.get('/token-trend', async (req: AuthRequest, res: Response): Promise<void> => {
  const { startMs, endMs } = getDateRange(req)

  type TokenRow = { day: string; promptTokens: bigint; completionTokens: bigint }
  const rows = await prisma.$queryRaw<TokenRow[]>`
    SELECT
      strftime('%Y-%m-%d', datetime(requestedAt/1000, 'unixepoch', 'localtime')) AS day,
      SUM(COALESCE(promptTokens,     0))       AS promptTokens,
      SUM(COALESCE(completionTokens, 0))       AS completionTokens
    FROM RequestLog
    WHERE requestedAt >= ${startMs} AND requestedAt <= ${endMs}
    GROUP BY day
    ORDER BY day ASC
  `

  res.json(
    rows.map((r) => ({
      day: r.day,
      promptTokens: Number(r.promptTokens),
      completionTokens: Number(r.completionTokens),
    }))
  )
})

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/model-distribution?startDate=&endDate=
// Request count + token usage per virtual model
// ---------------------------------------------------------------------------
router.get('/model-distribution', async (req: AuthRequest, res: Response): Promise<void> => {
  const { startMs, endMs } = getDateRange(req)

  type ModelRow = { virtualModel: string; requests: bigint; totalTokens: bigint }
  const rows = await prisma.$queryRaw<ModelRow[]>`
    SELECT
      virtualModel,
      COUNT(*)                                                           AS requests,
      SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0))   AS totalTokens
    FROM RequestLog
    WHERE requestedAt >= ${startMs} AND requestedAt <= ${endMs}
    GROUP BY virtualModel
    ORDER BY requests DESC
    LIMIT 30
  `

  res.json(
    rows.map((r) => ({
      virtualModel: r.virtualModel,
      requests: Number(r.requests),
      totalTokens: Number(r.totalTokens),
    }))
  )
})

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/channel-stats?startDate=&endDate=
// Per-channel: request count, error count, avg duration, total tokens
// ---------------------------------------------------------------------------
router.get('/channel-stats', async (req: AuthRequest, res: Response): Promise<void> => {
  const { startMs, endMs } = getDateRange(req)

  type ChanRow = {
    channelId: number | null
    channelName: string | null
    requests: bigint
    errors: bigint
    avgDuration: number | null
    totalTokens: bigint
  }
  const rows = await prisma.$queryRaw<ChanRow[]>`
    SELECT
      c.id                                                                AS channelId,
      c.name                                                              AS channelName,
      COUNT(r.id)                                                         AS requests,
      SUM(CASE WHEN r.errorMessage IS NOT NULL THEN 1 ELSE 0 END)        AS errors,
      AVG(r.duration)                                                     AS avgDuration,
      SUM(COALESCE(r.promptTokens, 0) + COALESCE(r.completionTokens, 0)) AS totalTokens
    FROM Channel c
    LEFT JOIN RequestLog r ON r.channelId = c.id
      AND r.requestedAt >= ${startMs} AND r.requestedAt <= ${endMs}
    GROUP BY c.id, c.name
    ORDER BY requests DESC
  `

  res.json(
    rows.map((r) => ({
      channelId: r.channelId,
      channelName: r.channelName ?? '(已删除)',
      requests: Number(r.requests),
      errors: Number(r.errors),
      errorRate: Number(r.requests) > 0
        ? (Number(r.errors) / Number(r.requests)) * 100
        : 0,
      avgDurationMs: r.avgDuration != null ? Math.round(r.avgDuration) : null,
      totalTokens: Number(r.totalTokens),
    }))
  )
})

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/response-time-trend?days=30&startDate=&endDate=
// Daily avg / max response time
// ---------------------------------------------------------------------------
router.get('/response-time-trend', async (req: AuthRequest, res: Response): Promise<void> => {
  const { startMs, endMs } = getDateRange(req)

  type RtRow = { day: string; avgDuration: number | null; maxDuration: number | null }
  const rows = await prisma.$queryRaw<RtRow[]>`
    SELECT
      strftime('%Y-%m-%d', datetime(requestedAt/1000, 'unixepoch', 'localtime')) AS day,
      AVG(duration)                     AS avgDuration,
      MAX(duration)                     AS maxDuration
    FROM RequestLog
    WHERE requestedAt >= ${startMs} AND requestedAt <= ${endMs}
      AND duration IS NOT NULL
    GROUP BY day
    ORDER BY day ASC
  `

  res.json(
    rows.map((r) => ({
      day: r.day,
      avgDuration: r.avgDuration != null ? Math.round(Number(r.avgDuration)) : null,
      maxDuration: r.maxDuration != null ? Math.round(Number(r.maxDuration)) : null,
    }))
  )
})

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/error-analysis?days=30&startDate=&endDate=
// Error rate trend + status code distribution
// ---------------------------------------------------------------------------
router.get('/error-analysis', async (req: AuthRequest, res: Response): Promise<void> => {
  const { startMs, endMs } = getDateRange(req)

  type ErrTrendRow = { day: string; total: bigint; errors: bigint }
  type StatusRow = { statusCode: number | null; count: bigint }

  const [trendRows, statusRows] = await Promise.all([
    prisma.$queryRaw<ErrTrendRow[]>`
      SELECT
        strftime('%Y-%m-%d', datetime(requestedAt/1000, 'unixepoch', 'localtime')) AS day,
        COUNT(*)                          AS total,
        SUM(CASE WHEN errorMessage IS NOT NULL THEN 1 ELSE 0 END) AS errors
      FROM RequestLog
      WHERE requestedAt >= ${startMs} AND requestedAt <= ${endMs}
      GROUP BY day
      ORDER BY day ASC
    `,
    prisma.$queryRaw<StatusRow[]>`
      SELECT statusCode, COUNT(*) AS count
      FROM RequestLog
      WHERE statusCode IS NOT NULL
        AND requestedAt >= ${startMs} AND requestedAt <= ${endMs}
      GROUP BY statusCode
      ORDER BY count DESC
    `,
  ])

  res.json({
    trend: trendRows.map((r) => ({
      day: r.day,
      total: Number(r.total),
      errors: Number(r.errors),
      errorRate: Number(r.total) > 0 ? (Number(r.errors) / Number(r.total)) * 100 : 0,
    })),
    statusCodes: statusRows.map((r) => ({
      statusCode: r.statusCode,
      count: Number(r.count),
    })),
  })
})

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/top-users?limit=10&startDate=&endDate=
// Top users by request count and token usage
// ---------------------------------------------------------------------------
router.get('/top-users', async (req: AuthRequest, res: Response): Promise<void> => {
  const limit = Math.min(parseInt(req.query.limit as string || '10', 10), 50)
  const { startMs, endMs } = getDateRange(req)

  type UserRow = {
    userId: number | null
    email: string | null
    requests: bigint
    promptTokens: bigint
    completionTokens: bigint
  }
  const rows = await prisma.$queryRaw<UserRow[]>`
    SELECT
      u.id                                   AS userId,
      u.email                                AS email,
      COUNT(r.id)                            AS requests,
      SUM(COALESCE(r.promptTokens,     0))   AS promptTokens,
      SUM(COALESCE(r.completionTokens, 0))   AS completionTokens
    FROM User u
    LEFT JOIN RequestLog r ON r.userId = u.id
      AND r.requestedAt >= ${startMs} AND r.requestedAt <= ${endMs}
    GROUP BY u.id, u.email
    ORDER BY requests DESC
    LIMIT ${limit}
  `

  res.json(
    rows.map((r) => ({
      userId: r.userId,
      email: r.email ?? '(已删除)',
      requests: Number(r.requests),
      promptTokens: Number(r.promptTokens),
      completionTokens: Number(r.completionTokens),
      totalTokens: Number(r.promptTokens) + Number(r.completionTokens),
    }))
  )
})

// ---------------------------------------------------------------------------
// GET /api/admin/analytics/channel-model-tokens?startDate=&endDate=
// Per channel × actual model: request count + prompt/completion token breakdown
// ---------------------------------------------------------------------------
router.get('/channel-model-tokens', async (req: AuthRequest, res: Response): Promise<void> => {
  const { startMs, endMs } = getDateRange(req)

  type CmRow = {
    channelName: string | null
    actualModel: string | null
    requests: bigint
    promptTokens: bigint
    completionTokens: bigint
  }
  const rows = await prisma.$queryRaw<CmRow[]>`
    SELECT
      c.name                                  AS channelName,
      r.actualModel                           AS actualModel,
      COUNT(r.id)                             AS requests,
      SUM(COALESCE(r.promptTokens,     0))    AS promptTokens,
      SUM(COALESCE(r.completionTokens, 0))    AS completionTokens
    FROM RequestLog r
    JOIN Channel c ON c.id = r.channelId
    WHERE r.actualModel IS NOT NULL
      AND r.requestedAt >= ${startMs} AND r.requestedAt <= ${endMs}
    GROUP BY c.id, c.name, r.actualModel
    ORDER BY c.name ASC, requests DESC
  `

  res.json(
    rows.map((r) => ({
      channelName: r.channelName ?? '(已删除)',
      actualModel: r.actualModel ?? '(未知)',
      requests: Number(r.requests),
      promptTokens: Number(r.promptTokens),
      completionTokens: Number(r.completionTokens),
      totalTokens: Number(r.promptTokens) + Number(r.completionTokens),
    }))
  )
})

export default router
