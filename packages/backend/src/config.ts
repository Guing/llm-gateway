import dotenv from 'dotenv'
dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '7500', 10),
  jwtSecret: process.env.JWT_SECRET || 'fallback-dev-secret',
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  encryptionKey: process.env.ENCRYPTION_KEY || '0'.repeat(64),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(','),
  // Set LOG_VERBOSE=true to enable detailed upstream request/response body logging
  logVerbose: process.env.LOG_VERBOSE === 'true',
  // Set SSE_MIRROR_DEBUG=true to mirror outgoing SSE data-line summaries for stream debugging.
  sseMirrorDebug: process.env.SSE_MIRROR_DEBUG === 'true',
  // Max number of mirrored data lines per request (default 20).
  sseMirrorMaxLines: Math.max(1, parseInt(process.env.SSE_MIRROR_MAX_LINES || '20', 10) || 20),
  // Set STREAM_FORMAT_DEBUG=true to log detected upstream stream event format once per request.
  streamFormatDebug: process.env.STREAM_FORMAT_DEBUG === 'true',
}
