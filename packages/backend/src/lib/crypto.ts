import crypto from 'crypto'
import { config } from '../config'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

/**
 * Generate a new gateway API key.
 * Format: sk-gw-<32 random bytes as base64url>
 */
export function generateApiKey(): string {
  const random = crypto.randomBytes(32).toString('base64url')
  return `sk-gw-${random}`
}

/**
 * Get the display prefix of an API key (first 12 chars).
 */
export function getKeyPrefix(key: string): string {
  return key.substring(0, 12)
}

/**
 * Hash an API key with SHA-256 for storage / lookup.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

function getEncryptionKey(): Buffer {
  const hexKey = config.encryptionKey
  if (hexKey.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hexKey, 'hex')
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns: <iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [
    iv.toString('hex'),
    tag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':')
}

/**
 * Decrypt a string encrypted with `encrypt()`.
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey()
  const parts = encryptedData.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format')
  }
  const [ivHex, tagHex, ciphertextHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}
