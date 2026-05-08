import { prisma } from '../lib/prisma'
import { decrypt } from '../lib/crypto'
import { logger } from '../lib/logger'

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
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0)
  let rand = Math.random() * totalWeight
  for (const candidate of candidates) {
    rand -= candidate.weight
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

  // Group by priority, sorted DESC
  const tiers = new Map<number, RouteCandidate[]>()
  for (const r of routes) {
    if (!tiers.has(r.priority)) tiers.set(r.priority, [])
    tiers.get(r.priority)!.push(r)
  }
  const sortedPriorities = [...tiers.keys()].sort((a, b) => b - a)

  let lastError: Error = new Error('Unknown error')

  for (const priority of sortedPriorities) {
    const tier = tiers.get(priority)!
    // Shuffle within tier using weights, try all candidates in the tier
    const shuffled = weightedShuffle(tier)

    for (const route of shuffled) {
      try {
        const result = await fn(route)
        return { result, route }
      } catch (err) {
        lastError = err as Error
        const message = lastError.message || ''
        // Only fallback on retriable errors
        const isRetriable =
          message.includes('429') ||
          message.includes('rate limit') ||
          message.includes('timeout') ||
          message.includes('ECONNREFUSED') ||
          message.includes('ECONNRESET') ||
          message.includes('503') ||
          message.includes('502') ||
          // Quota exhausted — try next channel if available
          message.includes('exceeded your current quota') ||
          message.includes('quota') ||
          // Temporary engine unavailability
          message.includes('engine is not available') ||
          message.includes('failed_precondition')

        if (!isRetriable) {
          throw lastError
        }

        logger.warn(`[Router] Channel "${route.channelName}" failed (${message}), trying next...`)
      }
    }
  }

  throw lastError
}

/**
 * Return a weight-biased shuffle of candidates
 * (higher weight = more likely to appear early).
 */
function weightedShuffle(candidates: RouteCandidate[]): RouteCandidate[] {
  const result: RouteCandidate[] = []
  const remaining = [...candidates]

  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, c) => sum + c.weight, 0)
    let rand = Math.random() * totalWeight
    let idx = 0
    for (let i = 0; i < remaining.length; i++) {
      rand -= remaining[i].weight
      if (rand <= 0) {
        idx = i
        break
      }
    }
    result.push(remaining.splice(idx, 1)[0])
  }

  return result
}
