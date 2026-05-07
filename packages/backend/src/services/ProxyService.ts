import fetch, { Response } from 'node-fetch'
import { RouteCandidate } from './RouterService'

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

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'LLM-Gateway/1.0',
  }

  let endpoint: string
  if (upstreamFormat === 'anthropic') {
    headers['x-api-key'] = decryptedApiKey
    headers['anthropic-version'] = '2023-06-01'
    endpoint = `${baseUrl.replace(/\/$/, '')}/v1/messages`
  } else {
    headers['Authorization'] = `Bearer ${decryptedApiKey}`
    endpoint = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(upstreamBody),
    // No timeout here — handled by the caller via Promise.race if needed
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Upstream ${route.channelName} returned ${response.status}: ${errorText}`
    )
  }

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
