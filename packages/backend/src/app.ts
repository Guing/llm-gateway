import express, { Express } from 'express'
import cors from 'cors'
import path from 'path'
import { config } from './config'

import authRoutes from './routes/auth'
import apiKeyRoutes from './routes/apiKeys'
import userRoutes from './routes/users'
import channelRoutes from './routes/channels'
import modelRouteRoutes from './routes/modelRoutes'
import logRoutes from './routes/logs'
import systemLogRoutes from './routes/systemLogs'
import settingsRoutes from './routes/settings'
import gatewayRoutes from './routes/gateway'

const app: Express = express()

// CORS — configurable via CORS_ORIGIN env var
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
}))

// Body parsing
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', env: config.nodeEnv })
})

// Auth routes
app.use('/api/auth', authRoutes)

// User-facing API key management
app.use('/api/keys', apiKeyRoutes)

// Admin routes
app.use('/api/admin/users', userRoutes)
app.use('/api/admin/channels', channelRoutes)
app.use('/api/admin/routes', modelRouteRoutes)

// Log viewing
app.use('/api/logs', logRoutes)
app.use('/api/admin/system-logs', systemLogRoutes)
app.use('/api/admin/settings', settingsRoutes)

// Gateway — OpenAI + Anthropic compatible
app.use('/v1', gatewayRoutes)

// Serve built frontend static files in production
if (config.nodeEnv === 'production') {
  const frontendDist = path.resolve(__dirname, '..', '..', 'frontend', 'dist')
  app.use(express.static(frontendDist))
  // SPA fallback — serve index.html for any non-API route
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/v1') || req.path === '/health') {
      return next()
    }
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

export default app
