import { Transform } from 'stream'
import { EventEmitter } from 'events'

export interface SSEEvent {
  event: string
  data: string
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

  /** Accumulated full assistant response content */
  public fullContent: string = ''
  public promptTokens: number | undefined
  public completionTokens: number | undefined

  createTransform(
    upstreamFormat: 'openai' | 'anthropic' | 'custom',
    targetFormat?: 'openai' | 'anthropic'
  ): Transform {
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
        // Handle any remaining data in buffer
        if (this.lineBuffer) {
          const transformed = this.processAndTransformLine(
            this.lineBuffer,
            upstreamFormat,
            targetFormat
          )
          if (transformed) {
            callback(null, Buffer.from(transformed + '\n'))
          } else {
            callback()
          }
          this.lineBuffer = ''
        } else {
          callback()
        }

        // Flush any pending event
        this.flushCurrentEventAndReturn(upstreamFormat, targetFormat)
        this.emit('done', {
          fullContent: this.fullContent,
          promptTokens: this.promptTokens,
          completionTokens: this.completionTokens,
        })
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
    targetFormat?: 'openai' | 'anthropic'
  ): string {
    if (line === '') {
      // Empty line = SSE message boundary; flush accumulated message
      return this.flushCurrentEventAndReturn(upstreamFormat, targetFormat)
    }

    if (line.startsWith('event: ')) {
      this.currentEventType = line.slice(7).trim()
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
    targetFormat?: 'openai' | 'anthropic'
  ): string {
    if (this.currentDataLines.length === 0) return ''

    const rawData = this.currentDataLines.join('\n')
    this.currentDataLines = []
    const eventType = this.currentEventType
    this.currentEventType = 'message'

    if (rawData === '[DONE]') {
      return 'data: [DONE]'
    }

    try {
      const parsed = JSON.parse(rawData)
      this.extractContent(parsed, upstreamFormat)

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
    toFormat: 'openai' | 'anthropic'
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

