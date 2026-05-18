import fetch, { Response } from 'node-fetch'
import { RouteCandidate } from './RouterService'
import { logger } from '../lib/logger'
import { CAPABILITY_DEGRADATION_MATRIX } from '../lib/capabilities'
import { getSettings } from '../lib/settings'

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OpenAIRequest {
  model: string
  messages: OpenAIMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  stop?: string | string[]
  [key: string]: unknown
}

export interface AnthropicRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  system?: string
  stream?: boolean
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop_sequences?: string[]
  [key: string]: unknown
}

/**
 * Convert OpenAI request format to Anthropic format.
 */
function openAIToAnthropic(req: OpenAIRequest): AnthropicRequest {
  const systemMessages = req.messages.filter((m) => m.role === 'system')
  const nonSystemMessages = req.messages.filter((m) => m.role !== 'system')

  return {
    model: req.model,
    max_tokens: req.max_tokens ?? 4096,
    system: systemMessages.map((m) => m.content).join('\n') || undefined,
    messages: nonSystemMessages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    stream: req.stream,
    temperature: req.temperature,
    top_p: req.top_p,
  }
}

/**
 * Convert Anthropic request format to OpenAI format.
 */
function anthropicToOpenAI(req: AnthropicRequest): OpenAIRequest {
  const messages: OpenAIMessage[] = []
  if (req.system) {
    messages.push({ role: 'system', content: req.system })
  }
  for (const m of req.messages) {
    messages.push({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })
  }
  return {
    model: req.model,
    messages,
    stream: req.stream,
    temperature: req.temperature,
    max_tokens: req.max_tokens,
    top_p: req.top_p,
  }
}

type RequestFormat = 'openai' | 'anthropic'

function normalizeOpenAIToolsPayload(body: Record<string, unknown>): void {
  const mapNonFunctionToolToFunction = (tool: Record<string, unknown>): Record<string, unknown> | null => {
    if (tool.type === 'custom') {
      const name = typeof tool.name === 'string' ? tool.name : ''
      if (!name) return null
      const parameters =
        (tool.parameters && typeof tool.parameters === 'object' ? tool.parameters : undefined) ??
        (tool.input_schema && typeof tool.input_schema === 'object' ? tool.input_schema : undefined) ??
        { type: 'object', properties: {}, additionalProperties: true }

      return {
        type: 'function',
        function: {
          name,
          description: typeof tool.description === 'string' ? tool.description : 'Custom tool proxied by gateway compatibility layer.',
          parameters,
          strict: typeof tool.strict === 'boolean' ? tool.strict : undefined,
        },
      }
    }

    if (tool.type === 'web_search') {
      return {
        type: 'function',
        function: {
          name: typeof tool.name === 'string' && tool.name.length > 0 ? tool.name : 'web_search',
          description: 'Search the web and return relevant results.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query to execute.',
              },
            },
            required: ['query'],
            additionalProperties: false,
          },
        },
      }
    }

    return null
  }

  // Legacy `functions` array -> modern `tools` array.
  if (!Array.isArray(body.tools) && Array.isArray(body.functions)) {
    body.tools = (body.functions as Array<Record<string, unknown>>)
      .map((fn) => {
        if (!fn || typeof fn !== 'object' || typeof fn.name !== 'string') return null
        return {
          type: 'function',
          function: {
            name: fn.name,
            description: typeof fn.description === 'string' ? fn.description : undefined,
            parameters: fn.parameters,
          },
        }
      })
      .filter(Boolean) as Array<Record<string, unknown>>
  }

  if (!Array.isArray(body.tools)) return

  const normalizedTools = (body.tools as Array<Record<string, unknown>>)
    .map((tool) => {
      if (!tool || typeof tool !== 'object') return null
      if (tool.type !== 'function') {
        return mapNonFunctionToolToFunction(tool)
      }

      // Already OpenAI Chat Completions format: { type: 'function', function: {...} }
      if (tool.function && typeof tool.function === 'object') {
        const fn = tool.function as Record<string, unknown>
        if (typeof fn.name !== 'string' || fn.name.length === 0) return null
        return {
          type: 'function',
          function: {
            name: fn.name,
            description: typeof fn.description === 'string' ? fn.description : undefined,
            parameters: fn.parameters,
            strict: typeof fn.strict === 'boolean' ? fn.strict : undefined,
          },
        }
      }

      // Responses-style flattened function tool: { type: 'function', name, parameters, ... }
      if (typeof tool.name === 'string' && tool.name.length > 0) {
        return {
          type: 'function',
          function: {
            name: tool.name,
            description: typeof tool.description === 'string' ? tool.description : undefined,
            parameters: tool.parameters,
            strict: typeof tool.strict === 'boolean' ? tool.strict : undefined,
          },
        }
      }

      return null
    })
    .filter(Boolean) as Array<Record<string, unknown>>

  if (normalizedTools.length === 0) {
    delete body.tools
    delete body.functions
    delete body.tool_choice
    delete body.parallel_tool_calls
    return
  }

  body.tools = normalizedTools

  // Normalize tool_choice for chat.completions function-call schema.
  if (body.tool_choice && typeof body.tool_choice === 'object') {
    const tc = body.tool_choice as Record<string, unknown>
    if (tc.type === 'function' && !tc.function && typeof tc.name === 'string') {
      body.tool_choice = {
        type: 'function',
        function: { name: tc.name },
      }
    } else if ((tc.type === 'custom' || tc.type === 'web_search') && !tc.function) {
      const functionName = typeof tc.name === 'string' && tc.name.length > 0
        ? tc.name
        : (tc.type === 'web_search' ? 'web_search' : '')
      if (functionName) {
        body.tool_choice = {
          type: 'function',
          function: { name: functionName },
        }
      }
    }
  }
}

/**
 * Strip parameters that are not supported by the target route's declared capability types.
 *
 * Driven by CAPABILITY_DEGRADATION_MATRIX: for every capability the route does NOT declare,
 * the corresponding request params are removed before forwarding. This prevents errors when
 * falling back from a capable route (e.g. reasoning) to one that doesn't declare that capability.
 *
 * Vision image-content filtering is a special case handled separately below (it requires
 * recursive message traversal rather than a simple top-level param deletion).
 */
function sanitizeRequestForRoute(
  body: Record<string, unknown>,
  types: string[],
  format: RequestFormat
): Record<string, unknown> {
  const b = { ...body }

  // Some OpenAI-compatible providers reject explicit null for structured fields.
  // Normalize reasoning/thinking by removing null keys and dropping empty objects.
  if (format === 'openai') {
    const normalizeNullableObjectField = (key: 'reasoning' | 'thinking') => {
      const value = b[key]
      if (value == null) {
        delete b[key]
        return
      }

      if (typeof value !== 'object' || Array.isArray(value)) return

      const normalized = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(([, v]) => v != null)
      )

      if (Object.keys(normalized).length === 0) {
        delete b[key]
      } else {
        b[key] = normalized
      }
    }

    normalizeNullableObjectField('reasoning')
    normalizeNullableObjectField('thinking')
  }

  // ── Matrix-driven flat param stripping ─────────────────────────────────────
  for (const [capability, rule] of Object.entries(CAPABILITY_DEGRADATION_MATRIX)) {
    if (types.includes(capability)) continue          // route declares this capability — keep params
    if (rule.canDegradeTo.length === 0) continue      // non-chat endpoint, stripping irrelevant

    const paramsToStrip = format === 'openai' ? rule.stripOpenAI : rule.stripAnthropic
    for (const param of paramsToStrip) {
      delete b[param]
    }
  }

  // ── Reasoning: strip reasoning_content from assistant messages (special case) ─
  // When a conversation history passes through a reasoning model, assistant messages
  // accumulate a `reasoning_content` field (the model's chain-of-thought).  Non-reasoning
  // upstreams (e.g. Mistral, GPT-4o) reject requests containing this field with 422.
  // We must strip it from every assistant message when the target route lacks 'reasoning'.
  if (!types.includes('reasoning') && Array.isArray(b.messages)) {
    b.messages = (b.messages as Array<Record<string, unknown>>).map((msg) => {
      if (msg.role !== 'assistant' || msg.reasoning_content === undefined) return msg
      const { reasoning_content: _rc, ...rest } = msg
      return rest
    })
  }

  // ── Vision: message-content filtering (special case) ───────────────────────
  // When route doesn't declare 'vision', strip image content from messages.
  // Image parts are replaced with a text placeholder so the request still makes
  // sense to the downstream model instead of failing with an unsupported-type error.
  if (!types.includes('vision')) {
    if (format === 'openai' && Array.isArray(b.messages)) {
      b.messages = (b.messages as Array<Record<string, unknown>>).map((msg) => {
        if (!Array.isArray(msg.content)) return msg
        // Filter out image_url parts; keep text parts only
        const textParts = (msg.content as Array<Record<string, unknown>>).filter(
          (part) => part.type !== 'image_url'
        )
        // If images were removed, append a note so the model knows
        const removedCount =
          (msg.content as Array<Record<string, unknown>>).length - textParts.length
        if (removedCount > 0) {
          textParts.push({
            type: 'text',
            text: `[${removedCount} image(s) were omitted because this model does not support vision]`,
          })
        }
        // Flatten back to a plain string when only one text part remains
        if (textParts.length === 1 && textParts[0].type === 'text') {
          return { ...msg, content: textParts[0].text }
        }
        return { ...msg, content: textParts }
      })
    }

    if (format === 'anthropic' && Array.isArray(b.messages)) {
      b.messages = (b.messages as Array<Record<string, unknown>>).map((msg) => {
        if (!Array.isArray(msg.content)) return msg
        const textParts = (msg.content as Array<Record<string, unknown>>).filter(
          (part) => part.type !== 'image'
        )
        const removedCount =
          (msg.content as Array<Record<string, unknown>>).length - textParts.length
        if (removedCount > 0) {
          textParts.push({
            type: 'text',
            text: `[${removedCount} image(s) were omitted because this model does not support vision]`,
          })
        }
        if (textParts.length === 1 && textParts[0].type === 'text') {
          return { ...msg, content: textParts[0].text }
        }
        return { ...msg, content: textParts }
      })
    }
  }

  // ── Null-content normalization (special case) ──────────────────────────────
  // Some strict OpenAI-compatible upstreams (e.g. certain CME Cloud / third-party
  // providers) reject messages where `content` is null/undefined AND `tool_calls`
  // is absent or undefined, responding with:
  //   "Either `content` or `tool_calls` must be set"
  // Normalise every message so that:
  //   • assistant messages with null/undefined content but with tool_calls keep
  //     content as-is (the tool_calls field satisfies the constraint).
  //   • any other message with null/undefined content gets content set to "".
  if (format === 'openai' && Array.isArray(b.messages)) {
    b.messages = (b.messages as Array<Record<string, unknown>>).map((msg) => {
      if (msg.content !== null && msg.content !== undefined) return msg
      const hasToolCalls = Array.isArray(msg.tool_calls) && (msg.tool_calls as unknown[]).length > 0
      if (hasToolCalls) return msg
      return { ...msg, content: '' }
    })
  }

  // OpenAI chat.completions only accepts function tools with nested `function` schema.
  // Normalize payload from Responses-style or legacy client formats.
  if (format === 'openai') {
    normalizeOpenAIToolsPayload(b)
  }

  return b
}

// ---------------------------------------------------------------------------
// Context-length truncation
// ---------------------------------------------------------------------------

/**
 * Rough token count estimate based on JSON-serialised byte length.
 * ~3 UTF-8 characters per token is a conservative heuristic that avoids
 * over-truncation for English text and code.
 */
function estimateTokens(obj: unknown): number {
  try {
    return Math.ceil(JSON.stringify(obj).length / 3)
  } catch {
    return 0
  }
}

/**
 * Group consecutive non-system messages into atomic units that must be
 * kept or dropped together.  An "atomic group" is:
 *   - An assistant message with tool_calls, plus all immediately-following
 *     tool messages whose tool_call_id matches one of those call IDs.
 *   - Any other single message.
 *
 * System messages are excluded from the input and handled separately.
 */
function buildMessageGroups(
  nonSystemMessages: Array<Record<string, unknown>>
): Array<Array<Record<string, unknown>>> {
  const groups: Array<Array<Record<string, unknown>>> = []
  let i = 0
  while (i < nonSystemMessages.length) {
    const msg = nonSystemMessages[i]
    if (
      msg.role === 'assistant' &&
      Array.isArray(msg.tool_calls) &&
      (msg.tool_calls as unknown[]).length > 0
    ) {
      const callIds = new Set(
        (msg.tool_calls as Array<Record<string, unknown>>)
          .map((tc) => tc.id)
          .filter((id) => typeof id === 'string' && id.length > 0) as string[]
      )
      const group: Array<Record<string, unknown>> = [msg]
      i++
      // Absorb all immediately-following tool messages that match a call ID.
      while (i < nonSystemMessages.length && nonSystemMessages[i].role === 'tool') {
        const toolMsg = nonSystemMessages[i]
        const toolCallId = typeof toolMsg.tool_call_id === 'string' ? toolMsg.tool_call_id : ''
        if (callIds.has(toolCallId)) {
          group.push(toolMsg)
          callIds.delete(toolCallId)
          i++
        } else {
          break
        }
      }
      groups.push(group)
    } else {
      groups.push([msg])
      i++
    }
  }
  return groups
}

/**
 * Truncate messages so that the estimated token count of the resulting
 * messages array fits within `contextLength * safetyFactor` tokens.
 *
 * Oldest non-system messages are dropped first, always in atomic groups
 * (assistant+tool_calls pairs are never separated).
 *
 * System messages are always preserved.
 */
function truncateMessagesForContextLimit(
  messages: Array<Record<string, unknown>>,
  contextLength: number
): Array<Record<string, unknown>> {
  // Reserve 15 % for the completion and system-overhead. Never go above that.
  const tokenLimit = Math.floor(contextLength * 0.85)
  if (estimateTokens(messages) <= tokenLimit) return messages

  const systemMsgs = messages.filter((m) => m.role === 'system')
  const nonSystemMsgs = messages.filter((m) => m.role !== 'system')
  const groups = buildMessageGroups(nonSystemMsgs)

  // Drop oldest groups from the front until we fit.
  let dropped = 0
  while (groups.length > 0) {
    const candidate = [...systemMsgs, ...groups.flatMap((g) => g)]
    if (estimateTokens(candidate) <= tokenLimit) break
    dropped += groups.shift()!.length
  }

  const result = [...systemMsgs, ...groups.flatMap((g) => g)]
  if (dropped > 0) {
    logger.info(
      `[Proxy] Context truncation: dropped ${dropped} messages ` +
      `(contextLength=${contextLength}, est=${estimateTokens(result)} tokens)`
    )
  }
  return result
}

/**
 * Forward a request to an upstream channel, handling format conversion.
 *
 * @param route     Selected upstream channel + model
 * @param body      Original request body (in `incomingFormat`)
 * @param incomingFormat  Format of the incoming request
 * @returns Raw fetch Response (do not consume body here for streaming)
 */
export async function proxyRequest(
  route: RouteCandidate,
  body: OpenAIRequest | AnthropicRequest,
  incomingFormat: RequestFormat
): Promise<Response> {
  const { baseUrl, decryptedApiKey, provider, actualModel } = route

  // Determine upstream format
  const upstreamFormat: RequestFormat =
    (provider === 'anthropic' || provider === 'custom-anthropic') ? 'anthropic' : 'openai'

  // Convert format if needed and substitute actual model name
  let upstreamBody: OpenAIRequest | AnthropicRequest
  if (incomingFormat === 'openai' && upstreamFormat === 'anthropic') {
    upstreamBody = openAIToAnthropic(body as OpenAIRequest)
    upstreamBody.model = actualModel
  } else if (incomingFormat === 'anthropic' && upstreamFormat === 'openai') {
    upstreamBody = anthropicToOpenAI(body as AnthropicRequest)
    upstreamBody.model = actualModel
  } else {
    // Same format — clone and replace model
    upstreamBody = { ...body, model: actualModel }
  }

  // Strip params not supported by this route's declared capability types.
  // This handles fallback from a capable route (e.g. reasoning) to a limited one.
  upstreamBody = sanitizeRequestForRoute(
    upstreamBody as Record<string, unknown>,
    route.types,
    upstreamFormat
  ) as typeof upstreamBody

  // Proactively truncate messages when a contextLength limit is configured for this route.
  if (
    getSettings().fallbackTruncateOnContextExceeded &&
    route.config.contextLength &&
    Array.isArray((upstreamBody as Record<string, unknown>).messages)
  ) {
    const bodyAny = upstreamBody as Record<string, unknown>
    bodyAny.messages = truncateMessagesForContextLimit(
      bodyAny.messages as Array<Record<string, unknown>>,
      route.config.contextLength
    )
  }

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'LLM-Gateway/1.0',
  }

  // Merge custom headers from route config (before auth to avoid overriding auth)
  if (route.config.customHeaders) {
    for (const [k, v] of Object.entries(route.config.customHeaders)) {
      headers[k] = v
    }
  }

  let endpoint: string
  if (upstreamFormat === 'anthropic') {
    // Standard Anthropic API uses x-api-key.
    // Custom Anthropic-compatible providers may use Authorization: Bearer instead,
    // so for custom-anthropic we send both headers to cover either scheme.
    headers['x-api-key'] = decryptedApiKey
    headers['anthropic-version'] = '2023-06-01'
    if (provider === 'custom-anthropic') {
      headers['Authorization'] = `Bearer ${decryptedApiKey}`
    }
    endpoint = `${baseUrl.replace(/\/$/, '')}/v1/messages`
  } else {
    headers['Authorization'] = `Bearer ${decryptedApiKey}`
    endpoint = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
  }

  const sentAt = Date.now()

  // Build a concise summary of what's being sent upstream
  const upstreamBodyAny = upstreamBody as Record<string, unknown>
  const msgCount = Array.isArray(upstreamBodyAny.messages)
    ? (upstreamBodyAny.messages as unknown[]).length : 0
  const systemLen = typeof upstreamBodyAny.system === 'string'
    ? upstreamBodyAny.system.length : 0
  const hasTools = !!(upstreamBodyAny.tools || upstreamBodyAny.functions)
  const maxTok = upstreamBodyAny.max_tokens ?? ''

  logger.info(
    `[Proxy] → ${upstreamFormat.toUpperCase()} ${endpoint}` +
    ` | channel=${route.channelName} model=${upstreamBody.model}` +
    ` stream=${!!(upstreamBodyAny).stream}` +
    ` msgs=${msgCount}${systemLen ? ` sys=${systemLen}chars` : ''}` +
    `${hasTools ? ' tools=yes' : ''}${maxTok ? ` max_tokens=${maxTok}` : ''}`
  )
  // Serialize once — reused for both verbose logging and the fetch body
  const bodyStr = JSON.stringify(upstreamBody)
  logger.verbose(`[Proxy] request body (${bodyStr.length} bytes): ${bodyStr.length > 2000 ? bodyStr.slice(0, 2000) + '…[truncated]' : bodyStr}`)

  // Configurable upstream timeout: per-route config takes priority, then env var, default 120s
  const proxyTimeoutMs = route.config.timeout ?? parseInt(process.env.PROXY_TIMEOUT_MS || '120000', 10)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), proxyTimeoutMs)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: bodyStr,
    signal: controller.signal,
  }).then(
    (r) => { clearTimeout(timeoutId); return r },
    (fetchErr: Error) => {
      clearTimeout(timeoutId)
      const elapsed = Date.now() - sentAt
      if (fetchErr.name === 'AbortError') {
        logger.warn(`[Proxy] ← timeout (${proxyTimeoutMs}ms) | channel=${route.channelName} ${elapsed}ms`)
        // "timeout" matches RouterService retry logic
        throw new Error(`timeout after ${proxyTimeoutMs}ms`)
      }
      logger.warn(`[Proxy] ← fetch error | channel=${route.channelName} | ${fetchErr.message}`)
      throw fetchErr
    }
  )

  const elapsed = Date.now() - sentAt

  if (!response.ok) {
    const errorText = await response.text()
    logger.warn(
      `[Proxy] ← ${response.status} ${response.statusText} | channel=${route.channelName} ${elapsed}ms` +
      ` | ${errorText.slice(0, 500)}`
    )
    throw new Error(
      `Upstream ${route.channelName} returned ${response.status}: ${errorText}`
    )
  }

  logger.info(`[Proxy] ← ${response.status} OK | channel=${route.channelName} ${elapsed}ms`)
  return response
}

/**
 * Convert an Anthropic non-streaming response to OpenAI format.
 */
export function anthropicResponseToOpenAI(data: Record<string, unknown>): Record<string, unknown> {
  const content = (data.content as Array<{ type: string; text: string }> | undefined) ?? []
  const text = content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')

  const usage = data.usage as
    | { input_tokens?: number; output_tokens?: number }
    | undefined

  return {
    id: data.id ?? `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model ?? '',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason:
          (data.stop_reason as string) === 'end_turn' ? 'stop' : data.stop_reason,
      },
    ],
    usage: {
      prompt_tokens: usage?.input_tokens ?? 0,
      completion_tokens: usage?.output_tokens ?? 0,
      total_tokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
    },
  }
}

/**
 * Convert an OpenAI non-streaming response to Anthropic format.
 */
export function openAIResponseToAnthropic(data: Record<string, unknown>): Record<string, unknown> {
  const choices = data.choices as Array<{
    message: { role: string; content: string }
    finish_reason: string
  }> | undefined
  const message = choices?.[0]?.message
  const usage = data.usage as
    | { prompt_tokens?: number; completion_tokens?: number }
    | undefined

  return {
    id: data.id ?? `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: message?.content ?? '' }],
    model: data.model ?? '',
    stop_reason:
      choices?.[0]?.finish_reason === 'stop' ? 'end_turn' : choices?.[0]?.finish_reason,
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
    },
  }
}
