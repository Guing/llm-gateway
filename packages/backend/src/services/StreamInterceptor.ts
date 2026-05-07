import { Transform } from 'stream'
import { EventEmitter } from 'events'

export interface SSEEvent {
  event: string
  data: string
}

/**
 * Intercepts SSE (Server-Sent Events) stream, parses content deltas,
 * while immediately passing all bytes through to the client unchanged.
 */
export class StreamInterceptor extends EventEmitter {
  private lineBuffer: string = ''
  private currentEventType: string = 'message'
  private currentDataLines: string[] = []

  /** Accumulated full assistant response content */
  public fullContent: string = ''
  public promptTokens: number | undefined
  public completionTokens: number | undefined

  createTransform(provider: 'openai' | 'anthropic' | 'custom'): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        const text = chunk.toString('utf-8')
        this.lineBuffer += text

        // Split on newlines, keep incomplete line in buffer
        const lines = this.lineBuffer.split('\n')
        this.lineBuffer = lines.pop() ?? ''

        for (const line of lines) {
          this.processLine(line.replace(/\r$/, ''), provider)
        }

        // Immediately pass through to client — do NOT block
        callback(null, chunk)
      },

      flush: (callback) => {
        // Handle any remaining data in buffer
        if (this.lineBuffer) {
          this.processLine(this.lineBuffer, provider)
          this.lineBuffer = ''
        }
        // Flush any pending event
        this.flushCurrentEvent(provider)
        this.emit('done', {
          fullContent: this.fullContent,
          promptTokens: this.promptTokens,
          completionTokens: this.completionTokens,
        })
        callback()
      },
    })
  }

  private processLine(
    line: string,
    provider: 'openai' | 'anthropic' | 'custom'
  ): void {
    if (line === '') {
      // Empty line = SSE message boundary
      this.flushCurrentEvent(provider)
      return
    }

    if (line.startsWith('event: ')) {
      this.currentEventType = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      this.currentDataLines.push(line.slice(6))
    }
    // Ignore 'id:' and 'retry:' lines
  }

  private flushCurrentEvent(
    provider: 'openai' | 'anthropic' | 'custom'
  ): void {
    if (this.currentDataLines.length === 0) return

    const rawData = this.currentDataLines.join('\n')
    this.currentDataLines = []
    const eventType = this.currentEventType
    this.currentEventType = 'message'

    if (rawData === '[DONE]') return

    try {
      const parsed = JSON.parse(rawData)
      this.extractContent(parsed, provider, eventType)
    } catch {
      // Not valid JSON, skip
    }
  }

  private extractContent(
    data: Record<string, unknown>,
    provider: 'openai' | 'anthropic' | 'custom',
    _eventType: string
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
