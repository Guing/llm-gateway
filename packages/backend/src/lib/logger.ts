import fs from 'fs'
import path from 'path'

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs')
const MAX_DAYS = 30

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

// ANSI color codes for TTY console
const COLORS: Record<LogLevel, string> = {
  INFO:  '\x1b[36m',  // cyan
  WARN:  '\x1b[33m',  // yellow
  ERROR: '\x1b[31m',  // red
  DEBUG: '\x1b[90m',  // dark gray
}
const RESET = '\x1b[0m'
const DIM   = '\x1b[2m'

// Padded level labels (all 5 chars)
const LEVEL_LABEL: Record<LogLevel, string> = {
  INFO:  'INFO ',
  WARN:  'WARN ',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG',
}

/** Local time: 2026-05-08 14:30:45.123 */
function formatTimestamp(): string {
  const now = new Date()
  const p = (n: number, d = 2) => String(n).padStart(d, '0')
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ` +
    `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}.${p(now.getMilliseconds(), 3)}`
  )
}

function getDateStr(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

// Cached flag — ensureLogDir is sync but only needs to run once
let logDirReady = false
function ensureLogDir() {
  if (logDirReady) return
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
  logDirReady = true
}

function purgeOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
    const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000
    for (const file of files) {
      const dateStr = file.replace('.log', '')
      if (new Date(dateStr).getTime() < cutoff) {
        fs.unlinkSync(path.join(LOG_DIR, file))
      }
    }
  } catch {
    // ignore cleanup errors
  }
}

function formatMeta(meta: unknown): string {
  if (meta === undefined || meta === null) return ''
  if (typeof meta === 'string') return ' ' + meta
  try {
    return ' ' + JSON.stringify(meta)
  } catch {
    return ' [unserializable]'
  }
}

/** Plain text line for file storage */
function formatPlain(level: LogLevel, message: string, meta?: unknown): string {
  return `${formatTimestamp()} [${LEVEL_LABEL[level]}] ${message}${formatMeta(meta)}\n`
}

/** Colored line for TTY console */
function formatColored(level: LogLevel, message: string, meta?: unknown): string {
  const color = COLORS[level]
  const metaStr = formatMeta(meta)
  return `${DIM}${formatTimestamp()}${RESET} ${color}[${LEVEL_LABEL[level]}]${RESET} ${message}${DIM}${metaStr}${RESET}\n`
}

// ---------------------------------------------------------------------------
// Async write queue — collects log lines and flushes to disk every FLUSH_MS
// (or when the buffer exceeds MAX_BYTES). Each flush is a single
// fs.appendFile call, batching N lines into one syscall while staying simple
// and reliable (no silent stream-error data loss).
// ---------------------------------------------------------------------------
class DailyWriteQueue {
  private pending: string[] = []
  private pendingBytes = 0
  private timer: NodeJS.Timeout | null = null

  private static readonly FLUSH_MS = 50
  private static readonly MAX_BYTES = 64 * 1024

  enqueue(line: string): void {
    this.pending.push(line)
    this.pendingBytes += line.length
    if (this.pendingBytes >= DailyWriteQueue.MAX_BYTES) {
      this.flush()
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), DailyWriteQueue.FLUSH_MS)
    }
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.pending.length === 0) return

    const content = this.pending.join('')
    this.pending = []
    this.pendingBytes = 0

    const logFile = path.join(LOG_DIR, `${getDateStr()}.log`)
    try {
      ensureLogDir()
    } catch (e) {
      process.stderr.write(`[logger] Cannot create log dir: ${(e as Error).message}\n`)
      return
    }
    fs.appendFile(logFile, content, 'utf8', (err) => {
      if (err) process.stderr.write(`[logger] Write failed (${logFile}): ${err.message}\n`)
    })
  }

  /** Flush pending lines before process exit so no lines are lost. */
  destroy(): void {
    this.flush()
  }
}

const queue = new DailyWriteQueue()

// Flush remaining buffer on clean shutdown so no lines are lost
process.once('SIGTERM', () => queue.destroy())
process.once('SIGINT',  () => queue.destroy())

// ---------------------------------------------------------------------------
// Initialise at startup (sync is fine here — before any requests)
// ---------------------------------------------------------------------------
ensureLogDir()
purgeOldLogs()

function write(level: LogLevel, message: string, meta?: unknown) {
  const useColor = (level === 'ERROR' ? process.stderr : process.stdout).isTTY
  const consoleLine = useColor
    ? formatColored(level, message, meta)
    : formatPlain(level, message, meta)

  if (level === 'ERROR') {
    process.stderr.write(consoleLine)
  } else {
    process.stdout.write(consoleLine)
  }

  // File: enqueue — zero blocking, batched flush every 50 ms
  queue.enqueue(formatPlain(level, message, meta))
}

export const logger = {
  info:  (message: string, meta?: unknown) => write('INFO',  message, meta),
  warn:  (message: string, meta?: unknown) => write('WARN',  message, meta),
  error: (message: string, meta?: unknown) => write('ERROR', message, meta),
  debug: (message: string, meta?: unknown) => {
    if (process.env.NODE_ENV !== 'production') write('DEBUG', message, meta)
  },
  /** Only logs when LOG_VERBOSE=true — use for detailed request/response bodies */
  verbose: (message: string, meta?: unknown) => {
    if (process.env.LOG_VERBOSE === 'true') write('DEBUG', message, meta)
  },
}
