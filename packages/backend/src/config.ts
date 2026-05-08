import dotenv from 'dotenv'
dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '7500', 10),
  jwtSecret: process.env.JWT_SECRET || 'fallback-dev-secret',
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  encryptionKey: process.env.ENCRYPTION_KEY || '0'.repeat(64),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(','),
}
