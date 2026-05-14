import { prisma } from '../lib/prisma'
import { decrypt } from '../lib/crypto'
import { logger } from '../lib/logger'
import { getSettings } from '../lib/settings'
import { isCapabilityRejectionError } from '../lib/capabilities'

export interface ModelRouteConfig {
  timeout?: number
  maxRetries?: number
  customHeaders?: Record<string, string>
  maxTokens?: number
  contextLength?: number
}

export interface RouteCandidate {
  routeId: number
  channelId: number
  channelName: string
  baseUrl: string
  decryptedApiKey: string
  provider: string
  actualModel: string
  priority: number
  weight: number
  types: string[]
  config: ModelRouteConfig
}

interface RouteHealthState {
  consecutiveFailures: number
  penaltyUntil: number
  lastFailureAt: number
}

export interface RouteHealthSnapshot {
  routeId: number
  consecutiveFailures: number
  penaltyUntil: number
  remainingPenaltyMs: number
}

const routeHealth = new Map<number, RouteHealthState>()

function getPenaltyConfig(): { baseMs: number; maxMs: number; ratio: number } {
  const s = getSettings()
  const baseMs = Number.isFinite(s.fallbackPenaltyBaseMs)
    ? Math.min(3_600_000, Math.max(1000, Math.round(s.fallbackPenaltyBaseMs)))
    : 30_000
  const maxMs = Number.isFinite(s.fallbackPenaltyMaxMs)
    ? Math.min(7_200_000, Math.max(baseMs, Math.round(s.fallbackPenaltyMaxMs)))
    : 5 * 60_000
  const ratio = Number.isFinite(s.fallbackPenaltyWeightRatio)
    ? Math.min(1, Math.max(0.01, s.fallbackPenaltyWeightRatio))
    : 0.2
  return { baseMs, maxMs, ratio }
}

function cleanupRouteHealth(now: number): void {
  for (const [routeId, state] of routeHealth.entries()) {
    if (state.penaltyUntil <= now) {
      routeHealth.delete(routeId)
    }
  }
}

function getEffectiveWeight(route: RouteCandidate, now = Date.now()): number {
  const { ratio } = getPenaltyConfig()
  const state = routeHealth.get(route.routeId)
  if (!state || state.penaltyUntil <= now) return Math.max(1, route.weight)
  // During penalty window, keep route available but much less likely.
  return Math.max(1, Math.floor(route.weight * ratio))
}

export function recordRouteFailure(route: RouteCandidate, reason: string): void {
  const now = Date.now()
  const { baseMs, maxMs } = getPenaltyConfig()
  const current = routeHealth.get(route.routeId)
  const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1
  const penaltyMs = Math.min(maxMs, baseMs * (2 ** (consecutiveFailures - 1)))
  const penaltyUntil = now + penaltyMs

  routeHealth.set(route.routeId, {
    consecutiveFailures,
    penaltyUntil,
    lastFailureAt: now,
  })

  logger.warn(
    `[Router] Health penalty applied to "${route.channelName}/${route.actualModel}"` +
    ` | failures=${consecutiveFailures} penalty=${Math.round(penaltyMs / 1000)}s` +
    ` | reason=${reason}`
  )
}

function recordRouteSuccess(route: RouteCandidate): void {
  const state = routeHealth.get(route.routeId)
  if (!state) return

  const nextFailures = Math.max(0, state.consecutiveFailures - 1)
  if (nextFailures === 0) {
    routeHealth.delete(route.routeId)
    return
  }

  routeHealth.set(route.routeId, {
    ...state,
    consecutiveFailures: nextFailures,
    penaltyUntil: Math.min(state.penaltyUntil, Date.now()),
  })
}

/**
 * Fetch all enabled routes for a virtual model name, ordered by priority DESC.
 */
export async function getRoutesForModel(
  virtualModel: string
): Promise<RouteCandidate[]> {
  const routes = await prisma.modelRoute.findMany({
    where: { virtualModel, enabled: true, channel: { enabled: true } },
    include: { channel: true },
    orderBy: { priority: 'desc' },
  })

  return routes.map((r) => ({
    routeId: r.id,
    channelId: r.channelId,
    channelName: r.channel.name,
    baseUrl: r.channel.baseUrl,
    decryptedApiKey: decrypt(r.channel.encryptedKey),
    provider: r.channel.provider,
    actualModel: r.actualModel,
    priority: r.priority,
    weight: r.weight,
    types: (() => { try { return JSON.parse(r.types || '[]') as string[] } catch { return [] } })(),
    config: (() => { try { return JSON.parse((r as unknown as { config?: string }).config || '{}') as ModelRouteConfig } catch { return {} } })(),
  }))
}

/**
 * Given a list of routes (already ordered by priority DESC),
 * group by priority tiers, then use weighted random within the highest tier.
 */
export function selectInitialRoute(
  routes: RouteCandidate[]
): RouteCandidate | null {
  if (routes.length === 0) return null
  cleanupRouteHealth(Date.now())

  // Group by priority
  const tiers = new Map<number, RouteCandidate[]>()
  for (const r of routes) {
    if (!tiers.has(r.priority)) tiers.set(r.priority, [])
    tiers.get(r.priority)!.push(r)
  }

  // Sorted priorities descending
  const sortedPriorities = [...tiers.keys()].sort((a, b) => b - a)

  // Try highest priority tier first
  const topTier = tiers.get(sortedPriorities[0])!
  return weightedRandom(topTier)
}

function weightedRandom(candidates: RouteCandidate[]): RouteCandidate {
  const now = Date.now()
  const totalWeight = candidates.reduce((sum, c) => sum + getEffectiveWeight(c, now), 0)
  let rand = Math.random() * totalWeight
  for (const candidate of candidates) {
    rand -= getEffectiveWeight(candidate, now)
    if (rand <= 0) return candidate
  }
  return candidates[candidates.length - 1]
}

/**
 * Execute fn with automatic fallback across priority tiers.
 * On 429 or timeout error, tries next priority tier or next candidate.
 */
export async function executeWithFallback<T>(
  routes: RouteCandidate[],
  fn: (route: RouteCandidate) => Promise<T>
): Promise<{ result: T; route: RouteCandidate }> {
  if (routes.length === 0) {
    throw new Error('No routes configured for this model')
  }
  cleanupRouteHealth(Date.now())

  // Group by priority, sorted DESC
  const tiers = new Map<number, RouteCandidate[]>()
  for (const r of routes) {
    if (!tiers.has(r.priority)) tiers.set(r.priority, [])
    tiers.get(r.priority)!.push(r)
  }
  const sortedPriorities = [...tiers.keys()].sort((a, b) => b - a)

  let lastError: Error = new Error('Unknown error')
  const settings = getSettings()

  for (const priority of sortedPriorities) {
    const tier = tiers.get(priority)!
    // Shuffle within tier using weights, try all candidates in the tier
    const shuffled = weightedShuffle(tier)

    for (const route of shuffled) {
      const maxRetries = route.config.maxRetries ?? 0
      let attempt = 0
      while (attempt <= maxRetries) {
        try {
          const result = await fn(route)
          recordRouteSuccess(route)
          return { result, route }
        } catch (err) {
          lastError = err as Error
          const message = lastError.message || ''
          attempt++

          // Only fallback/retry on retriable errors
          const isRetriable =
            settings.fallbackOnAnyError ||
            message.includes('429') ||
            message.includes('rate limit') ||
            message.includes('timeout') ||
            message.includes('Premature close') ||
            message.includes('stream start timeout') ||
            message.includes('ECONNREFUSED') ||
            message.includes('ECONNRESET') ||
            message.includes('500') ||
            message.includes('503') ||
            message.includes('502') ||
            message.includes('exceeded your current quota') ||
            message.includes('quota') ||
            message.includes('engine is not available') ||
            message.includes('failed_precondition') ||
            // Context length exceeded — fall back to a route with a larger context window
            (settings.fallbackTruncateOnContextExceeded && (
              message.includes('context_length_exceeded') ||
              message.includes('context length') ||
              message.includes('maximum context') ||
              (message.includes('max_tokens') && message.includes('exceed')) ||
              message.includes('tokens exceed') ||
              (message.includes('too long') && (message.includes('token') || message.includes('context'))) ||
              message.includes('input is too long') ||
              message.includes('prompt is too long')
            )) ||
            // Capability rejected at runtime — fall back to a route that supports it
            // (vision / function-calling / reasoning — driven by CAPABILITY_DEGRADATION_MATRIX)
            isCapabilityRejectionError(message)

          if (!isRetriable) throw lastError

          if (attempt <= maxRetries) {
            logger.warn(`[Router] Channel "${route.channelName}" failed (${message}), retrying (${attempt}/${maxRetries})...`)
          } else {
            recordRouteFailure(route, message)
            logger.warn(`[Router] Channel "${route.channelName}" failed (${message}), trying next...`)
          }
        }
      }
    }
  }

  throw lastError
}

export function getRouteHealthSnapshot(): RouteHealthSnapshot[] {
  const now = Date.now()
  cleanupRouteHealth(now)
  return [...routeHealth.entries()]
    .map(([routeId, state]) => ({
      routeId,
      consecutiveFailures: state.consecutiveFailures,
      penaltyUntil: state.penaltyUntil,
      remainingPenaltyMs: Math.max(0, state.penaltyUntil - now),
    }))
    .filter((x) => x.remainingPenaltyMs > 0)
    .sort((a, b) => b.remainingPenaltyMs - a.remainingPenaltyMs)
}

/**
 * Return a weight-biased shuffle of candidates
 * (higher weight = more likely to appear early).
 */
function weightedShuffle(candidates: RouteCandidate[]): RouteCandidate[] {
  const result: RouteCandidate[] = []
  const remaining = [...candidates]
  const now = Date.now()

  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, c) => sum + getEffectiveWeight(c, now), 0)
    let rand = Math.random() * totalWeight
    let idx = 0
    for (let i = 0; i < remaining.length; i++) {
      rand -= getEffectiveWeight(remaining[i], now)
      if (rand <= 0) {
        idx = i
        break
      }
    }
    result.push(remaining.splice(idx, 1)[0])
  }

  return result
}
