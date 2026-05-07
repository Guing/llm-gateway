import dotenv from 'dotenv'
dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'fallback-dev-secret',
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  encryptionKey: process.env.ENCRYPTION_KEY || '0'.repeat(64),
  nodeEnv: process.env.NODE_ENV || 'development',
}
