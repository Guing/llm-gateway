import { Router, Response, IRouter } from 'express'
import { pipeline, PassThrough } from 'stream'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { AuthRequest, apiKeyAuth } from '../middleware/authMiddleware'
import {
  getRoutesForModel,
  executeWithFallback,
  recordRouteFailure,
  RouteCandidate,
} from '../services/RouterService'
import {
  proxyRequest,
  anthropicResponseToOpenAI,
  openAIResponseToAnthropic,
} from '../services/ProxyService'
import { StreamInterceptor } from '../services/StreamInterceptor'
import { config } from '../config'

const router: IRouter = Router()
router.use(apiKeyAuth)

type GatewayFormat = 'openai' | 'anthropic' | 'openai-responses'

interface OpenAIToolCall {
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

function stringifyResponsesValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function extractResponsesTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const recordPart = part as Record<string, unknown>
      if (recordPart.type === 'input_text' || recordPart.type === 'output_text' || recordPart.type === 'text') {
        return typeof recordPart.text === 'string' ? recordPart.text : ''
      }
      return ''
    })
    .join('')
}

function mapResponsesMessageContentToOpenAI(content: unknown): unknown {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const mappedParts: Array<Record<string, unknown>> = []
  let droppedImageParts = 0

  for (const part of content) {
    if (typeof part === 'string') {
      if (part.length > 0) {
        mappedParts.push({ type: 'text', text: part })
      }
      continue
    }
    if (!part || typeof part !== 'object') continue

    const recordPart = part as Record<string, unknown>
    const type = typeof recordPart.type === 'string' ? recordPart.type : ''

    if (type === 'input_text' || type === 'output_text' || type === 'text') {
      const text = typeof recordPart.text === 'string' ? recordPart.text : ''
      if (text.length > 0) {
        mappedParts.push({ type: 'text', text })
      }
      continue
    }

    if (type === 'input_image' || type === 'image_url' || type === 'image') {
      const imageUrlField = recordPart.image_url
      const url =
        typeof imageUrlField === 'string'
          ? imageUrlField
          : (imageUrlField && typeof imageUrlField === 'object' && typeof (imageUrlField as Record<string, unknown>).url === 'string'
              ? ((imageUrlField as Record<string, unknown>).url as string)
              : (typeof recordPart.url === 'string' ? recordPart.url : ''))

      if (url.length > 0) {
        mappedParts.push({ type: 'image_url', image_url: { url } })
      } else {
        droppedImageParts += 1
      }
    }
  }

  if (mappedParts.length === 0) {
    if (droppedImageParts > 0) {
      return `[${droppedImageParts} image(s) were omitted because image URL was missing]`
    }
    return ''
  }

  if (mappedParts.length === 1 && mappedParts[0].type === 'text') {
    return mappedParts[0].text
  }

  return mappedParts
}

function responsesInputToMessages(input: unknown): Array<Record<string, unknown>> {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }]
  }

  if (!Array.isArray(input)) return []

  const messages: Array<Record<string, unknown>> = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>

    if (entry.type === 'message') {
      const role = entry.role === 'assistant' ? 'assistant' : 'user'
      const mappedContent = mapResponsesMessageContentToOpenAI(entry.content)
      if (
        (typeof mappedContent === 'string' && mappedContent.length > 0) ||
        (Array.isArray(mappedContent) && mappedContent.length > 0)
      ) {
        messages.push({ role, content: mappedContent })
      }
      continue
    }

    if (entry.type === 'input_text' && typeof entry.text === 'string') {
      messages.push({ role: 'user', content: entry.text })
      continue
    }

    if (entry.type === 'input_image') {
      const imageUrlField = entry.image_url
      const url =
        typeof imageUrlField === 'string'
          ? imageUrlField
          : (imageUrlField && typeof imageUrlField === 'object' && typeof (imageUrlField as Record<string, unknown>).url === 'string'
              ? ((imageUrlField as Record<string, unknown>).url as string)
              : (typeof entry.url === 'string' ? entry.url : ''))

      if (url.length > 0) {
        messages.push({
          role: 'user',
          content: [{ type: 'image_url', image_url: { url } }],
        })
      } else {
        messages.push({
          role: 'user',
          content: '[1 image was omitted because image URL was missing]',
        })
      }
      continue
    }

    if (entry.type === 'function_call') {
      const name = typeof entry.name === 'string' ? entry.name : ''
      const callId = typeof entry.call_id === 'string'
        ? entry.call_id
        : (typeof entry.id === 'string' ? entry.id : `call_${Date.now()}`)
      if (!name) continue

      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: callId,
            type: 'function',
            function: {
              name,
              arguments: stringifyResponsesValue(entry.arguments ?? ''),
            },
          },
        ],
      })
      continue
    }

    if (entry.type === 'function_call_output') {
      const callId = typeof entry.call_id === 'string' ? entry.call_id : ''
      if (!callId) continue
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content: stringifyResponsesValue(entry.output),
      })
    }
  }

  return messages
}

function inferDefaultToolName(tools: unknown): string {
  if (!Array.isArray(tools)) return 'tool'
  for (const t of tools as Array<Record<string, unknown>>) {
    if (!t || typeof t !== 'object') continue
    if (typeof t.name === 'string' && t.name) return t.name
    if (t.function && typeof t.function === 'object') {
      const fn = t.function as Record<string, unknown>
      if (typeof fn.name === 'string' && fn.name) return fn.name
    }
  }
  return 'tool'
}

function normalizeToolConversation(
  messages: Array<Record<string, unknown>>,
  tools: unknown
): Array<Record<string, unknown>> {
  const defaultToolName = inferDefaultToolName(tools)
  let immediateAssistantCallIds = new Set<string>()
  let injectedAssistantCalls = 0

  const normalized: Array<Record<string, unknown>> = []
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      const ids = (msg.tool_calls as Array<Record<string, unknown>>)
        .map((tc) => (typeof tc?.id === 'string' ? tc.id : ''))
        .filter((id) => id.length > 0)
      immediateAssistantCallIds = new Set(ids)
      normalized.push(msg)
      continue
    }

    if (msg.role !== 'tool') {
      immediateAssistantCallIds = new Set()
      normalized.push(msg)
      continue
    }

    const callId = typeof msg.tool_call_id === 'string'
      ? msg.tool_call_id
      : (typeof msg.call_id === 'string' ? msg.call_id : '')
    if (!callId) {
      // Invalid tool message for OpenAI chat format; drop to avoid upstream validation failure.
      continue
    }

    // Many OpenAI-compatible providers require the *immediately previous assistant*
    // message to contain a matching tool_call entry, not just "somewhere in history".
    if (!immediateAssistantCallIds.has(callId)) {
      const hintedName = typeof msg.name === 'string' && msg.name ? msg.name : defaultToolName
      normalized.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: callId,
            type: 'function',
            function: {
              name: hintedName,
              arguments: '{}',
            },
          },
        ],
      })
      immediateAssistantCallIds = new Set([callId])
      injectedAssistantCalls += 1
    }

    normalized.push(msg)
    immediateAssistantCallIds.delete(callId)
  }

  if (injectedAssistantCalls > 0) {
    logger.verbose(`[Gateway] injected synthetic assistant tool_calls=${injectedAssistantCalls}`)
  }

  return normalized
}

function mapResponsesRequestToOpenAI(body: Record<string, unknown>): Record<string, unknown> {
  const mapped = { ...body }
  const instructions = typeof body.instructions === 'string' ? body.instructions : undefined
  const inputMessages = responsesInputToMessages(body.input)
  const existingMessages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : []

  const messages: Array<Record<string, unknown>> = []
  if (instructions) {
    messages.push({ role: 'system', content: instructions })
  }
  messages.push(...existingMessages)
  messages.push(...inputMessages)

  if (messages.length > 0) {
    const normalizedMessages = normalizeToolConversation(messages, body.tools)
    mapped.messages = normalizedMessages

    const toolMsgCount = normalizedMessages.filter((m) => m.role === 'tool').length
    const assistantToolCallCount = normalizedMessages
      .filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
      .reduce((sum, m) => sum + (m.tool_calls as Array<unknown>).length, 0)
    logger.verbose(
      `[Gateway] responses->openai normalized messages=${normalizedMessages.length}` +
      ` tool_msgs=${toolMsgCount} assistant_tool_calls=${assistantToolCallCount}`
    )
  }
  if (typeof body.max_output_tokens === 'number') {
    mapped.max_tokens = body.max_output_tokens
  }

  delete mapped.input
  delete mapped.instructions
  delete mapped.max_output_tokens
  delete mapped.text
  delete mapped.response

  return mapped
}

function extractChatCompletionText(responseData: Record<string, unknown>): string {
  const choices = responseData.choices as Array<{
    message?: { content?: unknown }
  }> | undefined
  const content = choices?.[0]?.message?.content
  return extractResponsesTextContent(content)
}

function extractChatCompletionToolCalls(responseData: Record<string, unknown>): OpenAIToolCall[] {
  const choices = responseData.choices as Array<{
    message?: { tool_calls?: OpenAIToolCall[] }
  }> | undefined
  return choices?.[0]?.message?.tool_calls ?? []
}

function mapOpenAIToResponses(responseData: Record<string, unknown>, virtualModel: string): Record<string, unknown> {
  const usage = responseData.usage as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined

  const outputText = extractChatCompletionText(responseData)
  const toolCalls = extractChatCompletionToolCalls(responseData)
  const createdAt = typeof responseData.created === 'number'
    ? responseData.created
    : Math.floor(Date.now() / 1000)

  const output: Array<Record<string, unknown>> = [
    {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: outputText,
          annotations: [],
        },
      ],
    },
  ]

  output.push(
    ...toolCalls.map((toolCall, index) => ({
      id: toolCall.id ?? `fc_${Date.now()}_${index}`,
      type: 'function_call',
      call_id: toolCall.id ?? `fc_${Date.now()}_${index}`,
      name: toolCall.function?.name ?? '',
      arguments: toolCall.function?.arguments ?? '',
      status: 'completed',
    }))
  )

  return {
    id: responseData.id ?? `resp_${Date.now()}`,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    model: virtualModel,
    output,
    output_text: outputText,
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
      total_tokens:
        usage?.total_tokens ?? ((usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0)),
    },
  }
}

// ---------------------------------------------------------------------------
// Stream-start probe: wait for the first data chunk BEFORE committing to a route.
// Handles "200 OK + immediate close" — upstream says OK but never sends any SSE data.
// Resolves with a PassThrough that replays all buffered + future chunks.
// Throws if the connection closes or no data arrives within timeoutMs.
// ---------------------------------------------------------------------------
const STREAM_PROBE_TIMEOUT_MS = 15_000

function probeStream(
  source: NodeJS.ReadableStream,
  timeoutMs: number
): Promise<NodeJS.ReadableStream> {
  const pass = new PassThrough()

  // Forward source errors into the PassThrough (stream.pipe does NOT propagate errors).
  ;(source as import('stream').Readable).on('error', (err) => {
    if (!pass.destroyed) pass.destroy(err)
  })
  ;(source as import('stream').Readable).pipe(pass)

  return new Promise((resolve, reject) => {
    let settled = false

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pass.removeListener('readable', onReadable)
      pass.removeListener('error',    onError)
      pass.removeListener('end',      onEnd)
      fn()
    }

    const onReadable = () => settle(() => resolve(pass))
    const onError    = (e: Error) => settle(() => reject(e))
    // upstream closed before sending any SSE data
    const onEnd = () => settle(() => reject(new Error('Premature close')))

    const timer = setTimeout(() => {
      settle(() => {
        ;(source as import('stream').Readable).unpipe(pass)
        ;(source as import('stream').Readable).destroy(new Error('stream probe timeout'))
        pass.destroy()
        reject(new Error(`stream start timeout (${timeoutMs}ms) — upstream returned 200 but sent no data`))
      })
    }, timeoutMs)

    pass.on('readable', onReadable)
    pass.on('error',    onError)
    pass.on('end',      onEnd)
  })
}

// ---------------------------------------------------------------------------
// POST /v1/chat/completions  (OpenAI-compatible)
// ---------------------------------------------------------------------------
router.post('/chat/completions', async (req: AuthRequest, res: Response): Promise<void> => {
  await handleGatewayRequest(req, res, 'openai')
})

// ---------------------------------------------------------------------------
// POST /v1/responses  (OpenAI Responses-compatible; non-streaming)
// ---------------------------------------------------------------------------
router.post('/responses', async (req: AuthRequest, res: Response): Promise<void> => {
  await handleGatewayRequest(req, res, 'openai-responses')
})

// ---------------------------------------------------------------------------
// POST /v1/messages  (Anthropic-compatible)
// ---------------------------------------------------------------------------
router.post('/messages', async (req: AuthRequest, res: Response): Promise<void> => {
  await handleGatewayRequest(req, res, 'anthropic')
})

// ---------------------------------------------------------------------------
// Shared handler
// ---------------------------------------------------------------------------
async function handleGatewayRequest(
  req: AuthRequest,
  res: Response,
  incomingFormat: GatewayFormat
): Promise<void> {
  const body = incomingFormat === 'openai-responses'
    ? mapResponsesRequestToOpenAI(req.body as Record<string, unknown>)
    : (req.body as Record<string, unknown>)

  const virtualModel = typeof body.model === 'string' ? body.model : ''
  const isStreaming: boolean = body.stream === true
  const requestedAt = new Date()

  if (!virtualModel) {
    res.status(400).json({ error: '"model" field is required' })
    return
  }

  // Enrich request entry log
  const msgCount = Array.isArray(body.messages) ? (body.messages as unknown[]).length : 0
  const hasTools = !!(body.tools || body.functions)
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || '-'
  logger.info(
    `[Gateway] ← ${incomingFormat.toUpperCase()} ${virtualModel}${isStreaming ? ' [stream]' : ''}` +
    ` | msgs=${msgCount}${hasTools ? ' tools=yes' : ''}` +
    ` | user=${req.user?.id ?? '-'} key=${req.apiKeyRecord?.id ?? '-'} ip=${clientIp}`
  )

  // Look up routes
  let routes
  try {
    routes = await getRoutesForModel(virtualModel)
  } catch {
    logger.error(`[Gateway] Route lookup failed | model=${virtualModel}`)
    res.status(500).json({ error: 'Route lookup failed' })
    return
  }

  if (routes.length === 0) {
    logger.warn(`[Gateway] No routes for model: ${virtualModel}`)
    res.status(404).json({ error: `No routes configured for model "${virtualModel}"` })
    return
  }

  logger.debug(
    `[Gateway] Available routes: ` +
    routes.map((r) => `${r.channelName}/${r.actualModel}(p=${r.priority})`).join(', ')
  )

  // Normalize tool calls and responses for OpenAI-format requests.
  // Ensures tool_call_id in tool messages matches assistant.tool_calls,
  // and injects synthetic assistant messages for orphaned tool responses.
  if ((incomingFormat === 'openai' || incomingFormat === 'openai-responses') && 
      Array.isArray(body.messages) && hasTools) {
    const bodyAny = body as Record<string, unknown>
    bodyAny.messages = normalizeToolConversation(
      bodyAny.messages as Array<Record<string, unknown>>,
      bodyAny.tools
    )
  }

  if (isStreaming) {
    await handleStreaming(req, res, body, incomingFormat, routes, virtualModel, requestedAt)
  } else {
    await handleNonStreaming(req, res, body, incomingFormat, routes, virtualModel, requestedAt)
  }
}

// ---------------------------------------------------------------------------
// Non-streaming
// ---------------------------------------------------------------------------
async function handleNonStreaming(
  req: AuthRequest,
  res: Response,
  body: Record<string, unknown>,
  incomingFormat: GatewayFormat,
  routes: RouteCandidate[],
  virtualModel: string,
  requestedAt: Date
): Promise<void> {
  // Start log entry creation immediately — runs in parallel with upstream fetch
  const logCreatePromise = prisma.requestLog.create({
    data: {
      userId: req.user?.id ?? null,
      apiKeyId: req.apiKeyRecord?.id ?? null,
      virtualModel,
      requestBody: JSON.stringify(body),
      requestedAt,
      isStreaming: false,
    },
  })

  try {
    const proxyIncomingFormat: 'openai' | 'anthropic' = incomingFormat === 'anthropic' ? 'anthropic' : 'openai'
    const { result: upstreamResponse, route } = await executeWithFallback(
      routes,
      (r) => proxyRequest(r, body as never, proxyIncomingFormat)
    )

    const upstreamData = (await upstreamResponse.json()) as Record<string, unknown>
    const completedAt = new Date()
    const duration = completedAt.getTime() - requestedAt.getTime()

    // Determine format conversion
    const expectedProxyFormat: 'openai' | 'anthropic' = incomingFormat === 'anthropic' ? 'anthropic' : 'openai'
    const upstreamFormat = (route.provider === 'anthropic' || route.provider === 'custom-anthropic') ? 'anthropic' : 'openai'
    let responseData = upstreamData

    if (expectedProxyFormat === 'openai' && upstreamFormat === 'anthropic') {
      responseData = anthropicResponseToOpenAI(upstreamData)
    } else if (expectedProxyFormat === 'anthropic' && upstreamFormat === 'openai') {
      responseData = openAIResponseToAnthropic(upstreamData)
    }

    // Replace virtual model name in response
    if (responseData.model) responseData.model = virtualModel

    const normalizedForLog = responseData
    if (incomingFormat === 'openai-responses') {
      responseData = mapOpenAIToResponses(responseData, virtualModel)
    }

    // Extract token counts
    let promptTokens: number | undefined
    let completionTokens: number | undefined
    if (incomingFormat === 'anthropic') {
      const usage = (normalizedForLog.usage as { input_tokens?: number; output_tokens?: number } | undefined)
      promptTokens = usage?.input_tokens
      completionTokens = usage?.output_tokens
    } else {
      const usage = (normalizedForLog.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined)
      promptTokens = usage?.prompt_tokens
      completionTokens = usage?.completion_tokens
    }

    // Send response immediately — client does not wait for DB update
    res.json(responseData)

    // Fire-and-forget: update log in background
    logCreatePromise
      .then((logEntry) =>
        prisma.requestLog.update({
          where: { id: logEntry.id },
          data: {
            channelId: route.channelId,
            actualModel: route.actualModel,
            responseBody: JSON.stringify(responseData),
            completedAt,
            duration,
            promptTokens,
            completionTokens,
            statusCode: 200,
            modelTypes: JSON.stringify(route.types ?? []),
          },
        }).then(() =>
          logger.info(
            `[Gateway] ✓ #${logEntry.id} ${virtualModel} → ${route.channelName}/${route.actualModel}` +
            ` | ${duration}ms | in=${promptTokens ?? '?'} out=${completionTokens ?? '?'}`
          )
        )
      )
      .catch((e) => logger.error(`[Gateway] Failed to save log for ${virtualModel}: ${(e as Error).message}`))
  } catch (err) {
    const errorMessage = (err as Error).message
    const completedAt = new Date()
    const duration = completedAt.getTime() - requestedAt.getTime()
    logger.error(`[Gateway] ✗ ${virtualModel} | ${duration}ms | ${errorMessage}`)
    res.status(500).json({ error: errorMessage })
    // Best-effort log update (fire-and-forget)
    logCreatePromise
      .then((logEntry) =>
        prisma.requestLog.update({
          where: { id: logEntry.id },
          data: { completedAt, duration, statusCode: 500, errorMessage },
        })
      )
      .catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------
async function handleStreaming(
  req: AuthRequest,
  res: Response,
  body: Record<string, unknown>,
  incomingFormat: GatewayFormat,
  routes: RouteCandidate[],
  virtualModel: string,
  requestedAt: Date
): Promise<void> {
  // Set SSE headers immediately
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // Start log entry creation in parallel with upstream fetch — eliminates serial DB delay on TTFB
  const logCreatePromise = prisma.requestLog.create({
    data: {
      userId: req.user?.id ?? null,
      apiKeyId: req.apiKeyRecord?.id ?? null,
      virtualModel,
      requestBody: JSON.stringify(body),
      requestedAt,
      isStreaming: true,
    },
  })

  let selectedRoute: RouteCandidate | undefined

  try {
    const expectedProxyFormat: 'openai' | 'anthropic' = incomingFormat === 'anthropic' ? 'anthropic' : 'openai'
    const streamTargetFormat: 'openai' | 'anthropic' | 'openai-responses' =
      incomingFormat === 'openai-responses' ? 'openai-responses' : expectedProxyFormat

    const { result: { upstreamResponse, clientReadyBody, interceptor }, route } = await executeWithFallback(
      routes,
      async (r) => {
        const resp = await proxyRequest(r, body as never, expectedProxyFormat)
        if (!resp.body) throw new Error('Upstream returned empty body')
        // Probe: verify the stream actually starts delivering data before committing.
        // If the upstream returns 200 OK but immediately drops the connection, probeStream()
        // throws and executeWithFallback will fall back to the next route transparently.
        // Note: a premature close that happens AFTER data has already been sent to the client
        // (mid-stream) cannot be retried — the client has already received partial output.
        const upstreamProbed = await probeStream(resp.body as NodeJS.ReadableStream, STREAM_PROBE_TIMEOUT_MS)
        const upstreamFormat = (r.provider === 'anthropic' || r.provider === 'custom-anthropic') ? 'anthropic' : 'openai'
        const candidateInterceptor = new StreamInterceptor()
        const transform = candidateInterceptor.createTransform(upstreamFormat, streamTargetFormat, {
          responseModel: virtualModel,
          sseMirrorDebug: config.sseMirrorDebug,
          sseMirrorMaxLines: config.sseMirrorMaxLines,
          sseMirrorTag: `${virtualModel} -> ${r.channelName}/${r.actualModel}`,
          streamFormatDebug: config.streamFormatDebug,
          streamFormatTag: `${virtualModel} -> ${r.channelName}/${r.actualModel}`,
        })

        ;(upstreamProbed as import('stream').Readable).pipe(transform)

        try {
          // Only commit the route after the transformed stream yields the first
          // client-visible chunk. This allows fallback when the upstream closes
          // after raw bytes arrive but before a complete outbound SSE event exists.
          const transformedProbed = await probeStream(transform as unknown as NodeJS.ReadableStream, STREAM_PROBE_TIMEOUT_MS)
          return { upstreamResponse: resp, clientReadyBody: transformedProbed, interceptor: candidateInterceptor }
        } catch (err) {
          ;(upstreamProbed as import('stream').Readable).unpipe(transform)
          ;(upstreamProbed as import('stream').Readable).destroy(err as Error)
          transform.destroy(err as Error)
          throw err
        }
      }
    )
    selectedRoute = route

    // When streaming completes, save the full log
    interceptor.once('done', async (data: { fullContent: string; promptTokens?: number; completionTokens?: number }) => {
      const completedAt = new Date()
      const duration = completedAt.getTime() - requestedAt.getTime()

      // logCreatePromise is long resolved by the time the stream ends
      const logEntry = await logCreatePromise.catch(() => null)
      if (!logEntry) return

      // Build a synthetic response body for storage
      let responseBody: Record<string, unknown>
      if (incomingFormat === 'openai') {
        responseBody = {
          id: `chatcmpl-${logEntry.id}`,
          object: 'chat.completion',
          created: Math.floor(requestedAt.getTime() / 1000),
          model: virtualModel,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: data.fullContent },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: data.promptTokens ?? null,
            completion_tokens: data.completionTokens ?? null,
          },
        }
      } else if (incomingFormat === 'anthropic') {
        responseBody = {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: data.fullContent }],
          model: virtualModel,
          usage: {
            input_tokens: data.promptTokens ?? null,
            output_tokens: data.completionTokens ?? null,
          },
        }
      } else {
        responseBody = mapOpenAIToResponses(
          {
            id: `chatcmpl-${logEntry.id}`,
            object: 'chat.completion',
            created: Math.floor(requestedAt.getTime() / 1000),
            model: virtualModel,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: data.fullContent },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: data.promptTokens ?? 0,
              completion_tokens: data.completionTokens ?? 0,
              total_tokens: (data.promptTokens ?? 0) + (data.completionTokens ?? 0),
            },
          },
          virtualModel
        )
      }

      await prisma.requestLog.update({
        where: { id: logEntry.id },
        data: {
          channelId: selectedRoute!.channelId,
          actualModel: selectedRoute!.actualModel,
          responseBody: JSON.stringify(responseBody),
          completedAt,
          duration,
          promptTokens: data.promptTokens ?? null,
          completionTokens: data.completionTokens ?? null,
          statusCode: 200,
          modelTypes: JSON.stringify(selectedRoute!.types ?? []),
        },
      }).catch(() => {})
      logger.info(
        `[Gateway] ✓ #${logEntry.id} ${virtualModel} → ${selectedRoute!.channelName}/${selectedRoute!.actualModel}` +
        ` [stream] | ${duration}ms` +
        ` | in=${data.promptTokens ?? '?'} out=${data.completionTokens ?? '?'}`
      )
    })

    // Track whether the stream completed successfully via the 'done' event.
    // This prevents double-logging when pipeline() callback fires after done.
    let streamCompleted = false
    interceptor.once('done', () => { streamCompleted = true })

    // Abort upstream body if the client disconnects before the stream ends.
    req.on('close', () => {
      if (!streamCompleted && !res.writableEnded) {
        // node-fetch v2 body is a Node.js Readable at runtime; cast to access .destroy()
        ;(upstreamResponse.body as import('stream').Readable).destroy(new Error('client disconnected'))
      }
    })

    // pipeline() propagates errors through all streams and guarantees cleanup,
    // unlike .pipe() which silently stalls when the destination is destroyed.
    pipeline(
      clientReadyBody,
      res,
      async (pipelineErr) => {
        if (!pipelineErr || streamCompleted) return

        const completedAt = new Date()
        const duration = completedAt.getTime() - requestedAt.getTime()
        const errMsg = (pipelineErr as NodeJS.ErrnoException).message || 'stream pipeline error'
        const errCode = (pipelineErr as NodeJS.ErrnoException).code ?? ''

        // Distinguish a normal client disconnect from a real upstream/pipe error.
        const isClientDisconnect =
          errMsg.includes('client disconnected') ||
          errCode === 'ERR_STREAM_DESTROYED' ||
          errCode === 'ECONNRESET' ||
          errCode === 'EPIPE'

        if (isClientDisconnect) {
          logger.info(`[Gateway] ⚡ ${virtualModel} [stream] client disconnected | ${duration}ms`)
        } else {
          if (selectedRoute) {
            recordRouteFailure(selectedRoute, errMsg)
          }
          logger.error(`[Gateway] ✗ ${virtualModel} [stream pipe error] | ${duration}ms | ${errMsg}`)
        }

        const logEntry = await logCreatePromise.catch(() => null)
        if (logEntry) {
          await prisma.requestLog.update({
            where: { id: logEntry.id },
            data: {
              completedAt,
              duration,
              statusCode: isClientDisconnect ? 499 : 500,
              errorMessage: errMsg,
            },
          }).catch(() => {})
        }
      }
    )
  } catch (err) {
    const errorMessage = (err as Error).message
    const completedAt = new Date()
    const duration = completedAt.getTime() - requestedAt.getTime()
    logger.error(`[Gateway] ✗ ${virtualModel} [stream] | ${duration}ms | ${errorMessage}`)
    // Best-effort log update (fire-and-forget)
    logCreatePromise
      .then((logEntry) =>
        prisma.requestLog.update({
          where: { id: logEntry.id },
          data: { completedAt, duration, statusCode: 500, errorMessage },
        })
      )
      .catch(() => {})
    // SSE error message
    res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
    res.end()
  }
}

export default router
