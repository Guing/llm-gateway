/**
 * Capability Degradation Matrix
 *
 * Defines, for every model capability type, how the gateway should behave when a
 * chosen upstream route does NOT declare that capability:
 *
 *  canDegradeTo        — Which capabilities this one can gracefully fall back to.
 *                        Empty means no fallback is possible (requires a dedicated API endpoint).
 *  usesChatEndpoint    — Whether the capability uses /v1/chat/completions (or equivalent).
 *                        Non-chat capabilities cannot be served through the chat endpoint at all.
 *  stripOpenAI         — Top-level request body params to remove when route lacks this capability
 *                        and the upstream wire format is OpenAI-compatible.
 *  stripAnthropic      — Same but for Anthropic wire format.
 *  notSupportedPatterns— Regex patterns (case-insensitive) that match upstream error messages
 *                        indicating the route rejected the request due to lacking this capability.
 *                        Used by RouterService to decide whether fallback is warranted.
 *
 * Vision message-content filtering (stripping image_url / image blocks) is intentionally NOT
 * expressed as param names here because it requires recursive message traversal. That special
 * case is handled directly in ProxyService.sanitizeRequestForRoute.
 */

export type CapabilityType =
  | 'chat'
  | 'vision'
  | 'function-calling'
  | 'reasoning'
  | 'embedding'
  | 'rerank'
  | 'image-generation'
  | 'audio'
  | 'video-generation'

export interface CapabilityRule {
  canDegradeTo: CapabilityType[]
  usesChatEndpoint: boolean
  stripOpenAI: string[]
  stripAnthropic: string[]
  notSupportedPatterns: RegExp[]
}

export const CAPABILITY_DEGRADATION_MATRIX: Record<CapabilityType, CapabilityRule> = {
  // ── Base chat ──────────────────────────────────────────────────────────────
  chat: {
    canDegradeTo: [],
    usesChatEndpoint: true,
    stripOpenAI: [],
    stripAnthropic: [],
    notSupportedPatterns: [],
  },

  // ── Vision ─────────────────────────────────────────────────────────────────
  // Falls back to chat by stripping image content from messages (handled in ProxyService).
  vision: {
    canDegradeTo: ['chat'],
    usesChatEndpoint: true,
    stripOpenAI: [],    // message-level filtering, not a simple param delete
    stripAnthropic: [],
    notSupportedPatterns: [
      /image.*not\s*support/i,
      /unsupported.*image/i,
      /does not support.*image/i,
      /image.*unsupported/i,
      /vision.*not\s*support/i,
      /does not support.*vision/i,
      /multimodal.*not\s*support/i,
    ],
  },

  // ── Function calling ───────────────────────────────────────────────────────
  // Falls back to chat by stripping tools/functions params.
  'function-calling': {
    canDegradeTo: ['chat'],
    usesChatEndpoint: true,
    stripOpenAI: ['tools', 'functions', 'tool_choice', 'parallel_tool_calls'],
    stripAnthropic: ['tools', 'tool_choice'],
    notSupportedPatterns: [
      /tools.*not\s*support/i,
      /does not support.*tool/i,
      /tool_use.*not\s*support/i,
      /function.*not\s*support/i,
      /function calling is not supported/i,
      /tool use is not supported/i,
      /unsupported.*tool/i,
    ],
  },

  // ── Extended reasoning ─────────────────────────────────────────────────────
  // Falls back to chat by stripping reasoning_effort / thinking params AND
  // reasoning_content from assistant messages in conversation history.
  reasoning: {
    canDegradeTo: ['chat'],
    usesChatEndpoint: true,
    stripOpenAI: ['reasoning_effort', 'thinking'],
    stripAnthropic: ['thinking'],
    notSupportedPatterns: [
      /reasoning_effort.*not\s*support/i,
      /does not support.*reasoning/i,
      /thinking.*not\s*support/i,
      /does not support.*thinking/i,
      /extended thinking is not/i,
      /thinking is not supported/i,
      /unsupported.*reasoning/i,
      // reasoning_content in message history rejected by non-reasoning models
      /extra inputs are not permitted.*reasoning_content/i,
      /reasoning_content.*extra inputs/i,
      /reasoning_content.*not permitted/i,
    ],
  },

  // ── Non-chat capabilities — require dedicated endpoints, cannot be degraded ─
  embedding: {
    canDegradeTo: [],
    usesChatEndpoint: false,  // /v1/embeddings
    stripOpenAI: [],
    stripAnthropic: [],
    notSupportedPatterns: [],
  },

  rerank: {
    canDegradeTo: [],
    usesChatEndpoint: false,  // vendor-specific rerank endpoint
    stripOpenAI: [],
    stripAnthropic: [],
    notSupportedPatterns: [],
  },

  'image-generation': {
    canDegradeTo: [],
    usesChatEndpoint: false,  // /v1/images/generations
    stripOpenAI: [],
    stripAnthropic: [],
    notSupportedPatterns: [],
  },

  audio: {
    canDegradeTo: [],
    usesChatEndpoint: false,  // /v1/audio/speech or /v1/audio/transcriptions
    stripOpenAI: [],
    stripAnthropic: [],
    notSupportedPatterns: [],
  },

  'video-generation': {
    canDegradeTo: [],
    usesChatEndpoint: false,  // vendor-specific video endpoint
    stripOpenAI: [],
    stripAnthropic: [],
    notSupportedPatterns: [],
  },
}

/**
 * Returns true if the error message matches any "capability not supported at runtime"
 * pattern from the degradation matrix, but only for capabilities that have a fallback path.
 *
 * Used by RouterService.isRetriable to decide whether trying the next route is worthwhile.
 */
export function isCapabilityRejectionError(message: string): boolean {
  for (const rule of Object.values(CAPABILITY_DEGRADATION_MATRIX)) {
    if (rule.canDegradeTo.length === 0) continue  // non-degradable, no point retrying
    for (const pattern of rule.notSupportedPatterns) {
      if (pattern.test(message)) return true
    }
  }
  return false
}
