import './config' // load env first
import app from './app'
import { config } from './config'
import { prisma } from './lib/prisma'

async function main() {
  // Verify DB connection
  await prisma.$connect()
  console.log('[DB] Connected to SQLite database')

  app.listen(config.port, () => {
    console.log(`[Server] LLM Gateway running on http://localhost:${config.port}`)
    console.log(`[Server] Environment: ${config.nodeEnv}`)
  })
}

main().catch((err) => {
  console.error('[Fatal]', err)
  process.exit(1)
})
