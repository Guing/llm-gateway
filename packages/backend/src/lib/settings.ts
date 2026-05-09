/**
 * Lightweight JSON-file-backed global settings store.
 * Persisted to DATA_DIR/settings.json (same dir as the SQLite DB).
 * All reads/writes are sync — the file is tiny (<1 KB) and only accessed
 * during startup or on admin API calls, never on the hot request path.
 */
import fs from 'fs'
import path from 'path'

export interface GatewaySettings {
  /** When true, ANY upstream error (not just retriable ones) triggers fallback */
  fallbackOnAnyError: boolean
}

const DEFAULTS: GatewaySettings = {
  fallbackOnAnyError: false,
}

function getSettingsPath(): string {
  // DATA_DIR is the same directory that holds the SQLite database
  const dataDir = process.env.DATA_DIR
    || path.dirname(process.env.DATABASE_URL?.replace('file:', '') || '')
    || path.join(process.cwd(), 'prisma')
  return path.join(dataDir, 'settings.json')
}

let _cache: GatewaySettings | null = null

export function getSettings(): GatewaySettings {
  if (_cache) return _cache
  const filePath = getSettingsPath()
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    _cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GatewaySettings>) }
  } catch {
    _cache = { ...DEFAULTS }
  }
  return _cache
}

export function updateSettings(patch: Partial<GatewaySettings>): GatewaySettings {
  const current = getSettings()
  const updated: GatewaySettings = { ...current, ...patch }
  _cache = updated
  const filePath = getSettingsPath()
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf8')
  } catch (e) {
    // Non-fatal — settings are still updated in memory
    process.stderr.write(`[settings] Failed to persist settings: ${(e as Error).message}\n`)
  }
  return updated
}
