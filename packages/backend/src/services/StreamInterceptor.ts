import { Transform } from 'stream'
import { EventEmitter } from 'events'

export interface SSEEvent {
  event: string
  data: string
}

interface ResponsesFunctionCallState {
  id: string
  callId: string
  name: string
  arguments: string
  outputIndex: number
}

/**
 * Intercepts SSE (Server-Sent Events) stream, parses content deltas,
 * optionally converts between OpenAI ↔ Anthropic formats,
 * and passes transformed bytes to the client.
 */
export class StreamInterceptor extends EventEmitter {
  private lineBuffer: string = ''
  private currentEventType: string = 'message'
  private currentDataLines: string[] = []
  private responsesStreamStarted: boolean = false
  private responseId: string = `resp_${Date.now()}`
  private responseOutputItemId: string = `msg_${Date.now()}`
  private responseModel: string = ''
  private responseCreatedAt: number = Math.floor(Date.now() / 1000)
  private functionCalls: Map<number, ResponsesFunctionCallState> = new Map()

  /** Accumulated full assistant response content */
  public fullContent: string = ''
  public promptTokens: number | undefined
  public completionTokens: number | undefined

  createTransform(
    upstreamFormat: 'openai' | 'anthropic' | 'custom',
    targetFormat?: 'openai' | 'anthropic' | 'openai-responses',
    options?: { responseModel?: string }
  ): Transform {
    this.responsesStreamStarted = false
    this.responseId = `resp_${Date.now()}`
    this.responseOutputItemId = `msg_${Date.now()}`
    this.responseModel = options?.responseModel ?? ''
    this.responseCreatedAt = Math.floor(Date.now() / 1000)
    this.functionCalls = new Map()

    return new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        const text = chunk.toString('utf-8')
        this.lineBuffer += text

        // Split on newlines, keep incomplete line in buffer
        const lines = this.lineBuffer.split('\n')
        this.lineBuffer = lines.pop() ?? ''

        const output: string[] = []
        for (const line of lines) {
          const transformed = this.processAndTransformLine(
            line.replace(/\r$/, ''),
            upstreamFormat,
            targetFormat
          )
          if (transformed) {
            output.push(transformed)
          }
        }

        // Pass through transformed bytes
        callback(null, Buffer.from(output.join('\n') + (output.length > 0 ? '\n' : '')))
      },

      flush: (callback) => {
        let flushOutput = ''

        // Handle any remaining data in buffer
        if (this.lineBuffer) {
          const transformed = this.processAndTransformLine(
            this.lineBuffer,
            upstreamFormat,
            targetFormat
          )
          if (transformed) {
            flushOutput += transformed + '\n'
          }
          this.lineBuffer = ''
        }

        // Flush any pending event
        const finalFlush = this.flushCurrentEventAndReturn(upstreamFormat, targetFormat)
        if (finalFlush) flushOutput += finalFlush + '\n'

        if (targetFormat === 'openai-responses') {
          const completion = this.buildResponsesCompletionEvents()
          if (completion) flushOutput += completion + '\n'
        }

        this.emit('done', {
          fullContent: this.fullContent,
          promptTokens: this.promptTokens,
          completionTokens: this.completionTokens,
        })

        if (flushOutput) {
          callback(null, Buffer.from(flushOutput))
        } else {
          callback()
        }
      },
    })
  }

  /**
   * Process a single line from the SSE stream, applying format conversion if needed.
   * Accumulates multi-line data chunks and outputs complete SSE messages.
   */
  private processAndTransformLine(
    line: string,
    upstreamFormat: 'openai' | 'anthropic' | 'custom',
    targetFormat?: 'openai' | 'anthropic' | 'openai-responses'
  ): string {
    if (line === '') {
      // Empty line = SSE message boundary; flush accumulated message
      return this.flushCurrentEventAndReturn(upstreamFormat, targetFormat)
    }

    if (line.startsWith('event: ')) {
      this.currentEventType = line.slice(7).trim()
      if (targetFormat === 'openai-responses') return ''
      return line  // Pass through event line as-is
    } else if (line.startsWith('data: ')) {
      this.currentDataLines.push(line.slice(6))
      return ''  // Accumulate data, don't output yet
    }
    // Pass through other lines (id:, retry:, etc)
    return line
  }

  /**
   * Flush the current accumulated event, apply format conversion, and return the formatted output.
   */
  private flushCurrentEventAndReturn(
    upstreamFormat: 'openai' | 'anthropic' | 'custom',
    targetFormat?: 'openai' | 'anthropic' | 'openai-responses'
  ): string {
    if (this.currentDataLines.length === 0) return ''

    const rawData = this.currentDataLines.join('\n')
    this.currentDataLines = []
    const eventType = this.currentEventType
    this.currentEventType = 'message'

    if (rawData === '[DONE]') {
      return targetFormat === 'openai-responses' ? '' : 'data: [DONE]'
    }

    try {
      const parsed = JSON.parse(rawData)
      this.extractContent(parsed, upstreamFormat)

      if (targetFormat === 'openai-responses') {
        return this.convertToResponsesEvents(parsed, upstreamFormat)
      }

      // Convert format if needed
      const shouldConvert = targetFormat && targetFormat !== upstreamFormat &&
        !(upstreamFormat === 'custom' && targetFormat === 'openai')
      const convertedData = shouldConvert
        ? this.convertStreamChunk(parsed, upstreamFormat, targetFormat!)
        : parsed

      // Don't output empty objects
      if (Object.keys(convertedData).length === 0) {
        return ''
      }

      // Reconstruct SSE line
      const output: string[] = []
      if (eventType !== 'message') {
        output.push(`event: ${eventType}`)
      }
      output.push(`data: ${JSON.stringify(convertedData)}`)
      return output.join('\n')
    } catch {
      // Not valid JSON, skip
      return ''
    }
  }

  /**
   * Convert a single SSE event chunk from upstream format to target format.
   * Returns the converted JSON object suitable for SSE transmission.
   */
  private convertStreamChunk(
    data: Record<string, unknown>,
    fromFormat: 'openai' | 'anthropic' | 'custom',
    toFormat: 'openai' | 'anthropic' | 'openai-responses'
  ): Record<string, unknown> {
    // No conversion needed if formats match
    if (
      (fromFormat === 'openai' && toFormat === 'openai') ||
      (fromFormat === 'anthropic' && toFormat === 'anthropic') ||
      (fromFormat === 'custom' && toFormat === 'openai')
    ) {
      return data
    }

    // Convert Anthropic → OpenAI
    if (fromFormat === 'anthropic' && toFormat === 'openai') {
      const type = data.type as string
      if (type === 'content_block_delta') {
        const delta = data.delta as { type?: string; text?: string } | undefined
        if (delta?.type === 'text_delta' && delta.text) {
          return {
            choices: [
              {
                delta: { content: delta.text },
                index: 0,
              },
            ],
          }
        }
      } else if (type === 'message_delta') {
        const usage = data.usage as { output_tokens?: number } | undefined
        if (usage?.output_tokens != null) {
          return {
            choices: [{ index: 0 }],
            usage: {
              prompt_tokens: 0,
              completion_tokens: usage.output_tokens,
            },
          }
        }
      } else if (type === 'message_start') {
        const message = data.message as { usage?: { input_tokens?: number } } | undefined
        if (message?.usage?.input_tokens != null) {
          return {
            choices: [{ index: 0 }],
            usage: {
              prompt_tokens: message.usage.input_tokens,
              completion_tokens: 0,
            },
          }
        }
      }
      return {} // Non-mapped Anthropic events return empty (filtered)
    }

    // Convert OpenAI → Anthropic
    if (fromFormat === 'openai' && toFormat === 'anthropic') {
      const choices = data.choices as Array<{ delta?: { content?: string } }> | undefined
      if (choices && choices[0]?.delta?.content) {
        return {
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text: choices[0].delta.content,
          },
        }
      }
      const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
      if (usage && (usage.prompt_tokens != null || usage.completion_tokens != null)) {
        return {
          type: 'message_delta',
          delta: { type: 'thinking', thinking: '' },
          usage: {
            input_tokens: usage.prompt_tokens ?? 0,
            output_tokens: usage.completion_tokens ?? 0,
          },
        }
      }
      return {} // Non-mapped OpenAI events return empty (filtered)
    }

    return data
  }

  private sse(event: string, data: Record<string, unknown>): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n`
  }

  private ensureResponseMetaFromOpenAIChunk(data: Record<string, unknown>): void {
    const chunkId = typeof data.id === 'string' ? data.id : ''
    const created = typeof data.created === 'number' ? data.created : undefined
    const model = typeof data.model === 'string' ? data.model : undefined
    if (chunkId && this.responseId.startsWith('resp_')) this.responseId = chunkId
    if (created != null) this.responseCreatedAt = created
    if (model) this.responseModel = model
  }

  private buildResponseBase(status: 'in_progress' | 'completed'): Record<string, unknown> {
    const outputText = this.fullContent
    const output: Array<Record<string, unknown>> = []

    if (outputText || this.functionCalls.size === 0) {
      output.push({
        id: this.responseOutputItemId,
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: outputText,
            annotations: [],
          },
        ],
      })
    }

    for (const toolCall of [...this.functionCalls.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      output.push({
        id: toolCall.id,
        type: 'function_call',
        call_id: toolCall.callId,
        name: toolCall.name,
        arguments: toolCall.arguments,
        status: status === 'completed' ? 'completed' : 'in_progress',
      })
    }

    return {
      id: this.responseId,
      object: 'response',
      created_at: this.responseCreatedAt,
      status,
      model: this.responseModel,
      output,
      output_text: outputText,
      usage: {
        input_tokens: this.promptTokens ?? 0,
        output_tokens: this.completionTokens ?? 0,
        total_tokens: (this.promptTokens ?? 0) + (this.completionTokens ?? 0),
      },
    }
  }

  private buildResponsesCompletionEvents(): string {
    if (!this.responsesStreamStarted) {
      return ''
    }

    const parts: string[] = []
    for (const toolCall of [...this.functionCalls.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      parts.push(
        this.sse('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          response_id: this.responseId,
          output_index: toolCall.outputIndex,
          item_id: toolCall.id,
          arguments: toolCall.arguments,
        })
      )
      parts.push(
        this.sse('response.output_item.done', {
          type: 'response.output_item.done',
          response_id: this.responseId,
          output_index: toolCall.outputIndex,
          item: {
            id: toolCall.id,
            type: 'function_call',
            call_id: toolCall.callId,
            name: toolCall.name,
            arguments: toolCall.arguments,
            status: 'completed',
          },
        })
      )
    }

    parts.push(
      this.sse('response.output_text.done', {
        type: 'response.output_text.done',
        response_id: this.responseId,
        output_index: 0,
        item_id: this.responseOutputItemId,
        content_index: 0,
        text: this.fullContent,
      })
    )
    parts.push(
      this.sse('response.completed', {
        type: 'response.completed',
        response: this.buildResponseBase('completed'),
      })
    )
    parts.push('data: [DONE]\n')
    return parts.join('\n')
  }

  private convertToResponsesEvents(
    data: Record<string, unknown>,
    upstreamFormat: 'openai' | 'anthropic' | 'custom'
  ): string {
    const openAIChunk = upstreamFormat === 'anthropic'
      ? this.convertStreamChunk(data, 'anthropic', 'openai')
      : data

    if (Object.keys(openAIChunk).length === 0) return ''

    this.ensureResponseMetaFromOpenAIChunk(openAIChunk)

    const parts: string[] = []
    if (!this.responsesStreamStarted) {
      this.responsesStreamStarted = true
      parts.push(
        this.sse('response.created', {
          type: 'response.created',
          response: this.buildResponseBase('in_progress'),
        })
      )
    }

    const choices = openAIChunk.choices as Array<{
      delta?: {
        content?: string
        tool_calls?: Array<{
          index?: number
          id?: string
          function?: { name?: string; arguments?: string }
        }>
      }
    }> | undefined
    const deltaText = choices?.[0]?.delta?.content
    if (typeof deltaText === 'string' && deltaText.length > 0) {
      parts.push(
        this.sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          response_id: this.responseId,
          output_index: 0,
          item_id: this.responseOutputItemId,
          content_index: 0,
          delta: deltaText,
        })
      )
    }

    const toolCalls = choices?.[0]?.delta?.tool_calls ?? []
    for (const toolCall of toolCalls) {
      const index = toolCall.index ?? 0
      const existing = this.functionCalls.get(index) ?? {
        id: toolCall.id ?? `fc_${Date.now()}_${index}`,
        callId: toolCall.id ?? `fc_${Date.now()}_${index}`,
        name: toolCall.function?.name ?? '',
        arguments: '',
        outputIndex: index + 1,
      }

      if (toolCall.id) {
        existing.id = toolCall.id
        existing.callId = toolCall.id
      }
      if (toolCall.function?.name) {
        existing.name = toolCall.function.name
      }

      const argumentDelta = toolCall.function?.arguments ?? ''
      const isNew = !this.functionCalls.has(index)
      existing.arguments += argumentDelta
      this.functionCalls.set(index, existing)

      if (isNew) {
        parts.push(
          this.sse('response.output_item.added', {
            type: 'response.output_item.added',
            response_id: this.responseId,
            output_index: existing.outputIndex,
            item: {
              id: existing.id,
              type: 'function_call',
              call_id: existing.callId,
              name: existing.name,
              arguments: '',
              status: 'in_progress',
            },
          })
        )
      }

      if (argumentDelta) {
        parts.push(
          this.sse('response.function_call_arguments.delta', {
            type: 'response.function_call_arguments.delta',
            response_id: this.responseId,
            output_index: existing.outputIndex,
            item_id: existing.id,
            delta: argumentDelta,
          })
        )
      }
    }

    return parts.join('\n')
  }

  private extractContent(
    data: Record<string, unknown>,
    provider: 'openai' | 'anthropic' | 'custom',
    _eventType?: string
  ): void {
    if (provider === 'openai' || provider === 'custom') {
      // OpenAI streaming delta format
      const choices = data.choices as Array<{
        delta?: { content?: string }
      }> | undefined
      if (choices && choices[0]?.delta?.content) {
        this.fullContent += choices[0].delta.content
      }
      // OpenAI usage (only in last chunk when stream_options.include_usage=true)
      const usage = data.usage as
        | { prompt_tokens?: number; completion_tokens?: number }
        | undefined
      if (usage) {
        if (usage.prompt_tokens != null) this.promptTokens = usage.prompt_tokens
        if (usage.completion_tokens != null)
          this.completionTokens = usage.completion_tokens
      }
    } else if (provider === 'anthropic') {
      // Anthropic streaming delta format
      const type = data.type as string
      if (type === 'content_block_delta') {
        const delta = data.delta as { type?: string; text?: string } | undefined
        if (delta?.type === 'text_delta' && delta.text) {
          this.fullContent += delta.text
        }
      } else if (type === 'message_delta') {
        const usage = data.usage as
          | { output_tokens?: number }
          | undefined
        if (usage?.output_tokens != null)
          this.completionTokens = usage.output_tokens
      } else if (type === 'message_start') {
        const message = data.message as {
          usage?: { input_tokens?: number; output_tokens?: number }
        } | undefined
        if (message?.usage?.input_tokens != null)
          this.promptTokens = message.usage.input_tokens
      }
    }
  }
}

