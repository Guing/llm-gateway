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

function getLogFile(): string {
  return path.join(LOG_DIR, `${getDateStr()}.log`)
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
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

  // File always plain text — async write to avoid blocking the event loop
  try {
    ensureLogDir()
    fs.appendFile(getLogFile(), formatPlain(level, message, meta), 'utf8', () => { /* fire-and-forget */ })
  } catch {
    // ignore file write errors to avoid crashing the app
  }
}

// Purge old logs once at startup
ensureLogDir()
purgeOldLogs()

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
