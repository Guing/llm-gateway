import express, { Express } from 'express'
import cors from 'cors'
import { config } from './config'

import authRoutes from './routes/auth'
import apiKeyRoutes from './routes/apiKeys'
import userRoutes from './routes/users'
import channelRoutes from './routes/channels'
import modelRouteRoutes from './routes/modelRoutes'
import logRoutes from './routes/logs'
import gatewayRoutes from './routes/gateway'

const app: Express = express()

// CORS
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
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

// Gateway — OpenAI + Anthropic compatible
app.use('/v1', gatewayRoutes)

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

export default app
