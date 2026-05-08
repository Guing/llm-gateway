import fs from 'fs'
import path from 'path'

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs')
const MAX_DAYS = 30

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

function getDateStr(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
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

function formatMessage(level: LogLevel, message: string, meta?: unknown): string {
  const ts = new Date().toISOString()
  const metaStr = meta !== undefined ? ' ' + JSON.stringify(meta) : ''
  return `[${ts}] [${level}] ${message}${metaStr}\n`
}

function write(level: LogLevel, message: string, meta?: unknown) {
  const line = formatMessage(level, message, meta)

  // Always print to console
  if (level === 'ERROR') {
    process.stderr.write(line)
  } else {
    process.stdout.write(line)
  }

  // Write to daily log file
  try {
    ensureLogDir()
    fs.appendFileSync(getLogFile(), line, 'utf8')
  } catch {
    // ignore file write errors to avoid crashing the app
  }
}

// Purge old logs once at startup
ensureLogDir()
purgeOldLogs()

export const logger = {
  info: (message: string, meta?: unknown) => write('INFO', message, meta),
  warn: (message: string, meta?: unknown) => write('WARN', message, meta),
  error: (message: string, meta?: unknown) => write('ERROR', message, meta),
  debug: (message: string, meta?: unknown) => {
    if (process.env.NODE_ENV !== 'production') write('DEBUG', message, meta)
  },
}
