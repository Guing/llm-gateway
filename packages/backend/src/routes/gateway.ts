import { Router, Response, IRouter } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, apiKeyAuth } from '../middleware/authMiddleware'
import {
  getRoutesForModel,
  executeWithFallback,
  RouteCandidate,
} from '../services/RouterService'
import {
  proxyRequest,
  anthropicResponseToOpenAI,
  openAIResponseToAnthropic,
} from '../services/ProxyService'
import { StreamInterceptor } from '../services/StreamInterceptor'

const router: IRouter = Router()
router.use(apiKeyAuth)

// ---------------------------------------------------------------------------
// POST /v1/chat/completions  (OpenAI-compatible)
// ---------------------------------------------------------------------------
router.post('/chat/completions', async (req: AuthRequest, res: Response): Promise<void> => {
  await handleGatewayRequest(req, res, 'openai')
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
  incomingFormat: 'openai' | 'anthropic'
): Promise<void> {
  const body = req.body
  const virtualModel: string = body.model
  const isStreaming: boolean = body.stream === true
  const requestedAt = new Date()

  if (!virtualModel) {
    res.status(400).json({ error: '"model" field is required' })
    return
  }

  // Look up routes
  let routes
  try {
    routes = await getRoutesForModel(virtualModel)
  } catch {
    res.status(500).json({ error: 'Route lookup failed' })
    return
  }

  if (routes.length === 0) {
    res.status(404).json({ error: `No routes configured for model "${virtualModel}"` })
    return
  }

  // Create initial log record
  const logEntry = await prisma.requestLog.create({
    data: {
      userId: req.user?.id ?? null,
      apiKeyId: req.apiKeyRecord?.id ?? null,
      virtualModel,
      requestBody: JSON.stringify(body),
      requestedAt,
      isStreaming,
    },
  })

  if (isStreaming) {
    await handleStreaming(req, res, body, incomingFormat, routes, logEntry.id, virtualModel, requestedAt)
  } else {
    await handleNonStreaming(req, res, body, incomingFormat, routes, logEntry.id, virtualModel, requestedAt)
  }
}

// ---------------------------------------------------------------------------
// Non-streaming
// ---------------------------------------------------------------------------
async function handleNonStreaming(
  req: AuthRequest,
  res: Response,
  body: Record<string, unknown>,
  incomingFormat: 'openai' | 'anthropic',
  routes: RouteCandidate[],
  logId: number,
  virtualModel: string,
  requestedAt: Date
): Promise<void> {
  try {
    const { result: upstreamResponse, route } = await executeWithFallback(
      routes,
      (r) => proxyRequest(r, body as never, incomingFormat)
    )

    const upstreamData = (await upstreamResponse.json()) as Record<string, unknown>
    const completedAt = new Date()
    const duration = completedAt.getTime() - requestedAt.getTime()

    // Determine format conversion
    const upstreamFormat = route.provider === 'anthropic' ? 'anthropic' : 'openai'
    let responseData = upstreamData

    if (incomingFormat === 'openai' && upstreamFormat === 'anthropic') {
      responseData = anthropicResponseToOpenAI(upstreamData)
    } else if (incomingFormat === 'anthropic' && upstreamFormat === 'openai') {
      responseData = openAIResponseToAnthropic(upstreamData)
    }

    // Replace virtual model name in response
    if (responseData.model) responseData.model = virtualModel

    // Extract token counts
    let promptTokens: number | undefined
    let completionTokens: number | undefined
    if (incomingFormat === 'openai') {
      const usage = (responseData.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined)
      promptTokens = usage?.prompt_tokens
      completionTokens = usage?.completion_tokens
    } else {
      const usage = (responseData.usage as { input_tokens?: number; output_tokens?: number } | undefined)
      promptTokens = usage?.input_tokens
      completionTokens = usage?.output_tokens
    }

    // Update log
    await prisma.requestLog.update({
      where: { id: logId },
      data: {
        channelId: route.channelId,
        actualModel: route.actualModel,
        responseBody: JSON.stringify(responseData),
        completedAt,
        duration,
        promptTokens,
        completionTokens,
        statusCode: 200,
      },
    })

    res.json(responseData)
  } catch (err) {
    const errorMessage = (err as Error).message
    const completedAt = new Date()
    await prisma.requestLog.update({
      where: { id: logId },
      data: {
        completedAt,
        duration: completedAt.getTime() - requestedAt.getTime(),
        statusCode: 500,
        errorMessage,
      },
    })
    res.status(500).json({ error: errorMessage })
  }
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------
async function handleStreaming(
  req: AuthRequest,
  res: Response,
  body: Record<string, unknown>,
  incomingFormat: 'openai' | 'anthropic',
  routes: RouteCandidate[],
  logId: number,
  virtualModel: string,
  requestedAt: Date
): Promise<void> {
  // Set SSE headers immediately
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  let selectedRoute: RouteCandidate | undefined

  try {
    const { result: upstreamResponse, route } = await executeWithFallback(
      routes,
      (r) => proxyRequest(r, body as never, incomingFormat)
    )
    selectedRoute = route

    if (!upstreamResponse.body) {
      throw new Error('Upstream returned empty body')
    }

    const upstreamFormat = route.provider === 'anthropic' ? 'anthropic' : 'openai'
    const interceptor = new StreamInterceptor()

    // When streaming completes, save the full log
    interceptor.once('done', async (data: { fullContent: string; promptTokens?: number; completionTokens?: number }) => {
      const completedAt = new Date()

      // Build a synthetic response body for storage
      let responseBody: Record<string, unknown>
      if (incomingFormat === 'openai') {
        responseBody = {
          id: `chatcmpl-${logId}`,
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
      } else {
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
      }

      await prisma.requestLog.update({
        where: { id: logId },
        data: {
          channelId: selectedRoute!.channelId,
          actualModel: selectedRoute!.actualModel,
          responseBody: JSON.stringify(responseBody),
          completedAt,
          duration: completedAt.getTime() - requestedAt.getTime(),
          promptTokens: data.promptTokens ?? null,
          completionTokens: data.completionTokens ?? null,
          statusCode: 200,
        },
      }).catch(() => {})
    })

    // Pipe: upstream body → SSE interceptor (passthrough) → client
    const transform = interceptor.createTransform(upstreamFormat)

    upstreamResponse.body
      .pipe(transform)
      .pipe(res)

    upstreamResponse.body.on('error', async (err: Error) => {
      const completedAt = new Date()
      await prisma.requestLog.update({
        where: { id: logId },
        data: {
          completedAt,
          duration: completedAt.getTime() - requestedAt.getTime(),
          statusCode: 500,
          errorMessage: err.message,
        },
      }).catch(() => {})
    })
  } catch (err) {
    const errorMessage = (err as Error).message
    const completedAt = new Date()
    await prisma.requestLog.update({
      where: { id: logId },
      data: {
        completedAt,
        duration: completedAt.getTime() - requestedAt.getTime(),
        statusCode: 500,
        errorMessage,
      },
    }).catch(() => {})

    // SSE error message
    res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
    res.end()
  }
}

export default router
