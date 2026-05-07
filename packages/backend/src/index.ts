import './config' // load env first
import app from './app'
import { config } from './config'
import { prisma } from './lib/prisma'
import bcrypt from 'bcryptjs'

async function ensureAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@gateway.local'
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (!existing) {
    const hashed = await bcrypt.hash(adminPassword, 12)
    await prisma.user.create({ data: { email: adminEmail, password: hashed, role: 'admin' } })
    console.log(`[Seed] Admin user created: ${adminEmail}`)
  }
}

async function main() {
  // Verify DB connection
  await prisma.$connect()
  console.log('[DB] Connected to SQLite database')

  // Auto-create admin user on first boot
  await ensureAdminUser()

  app.listen(config.port, () => {
    console.log(`[Server] LLM Gateway running on http://localhost:${config.port}`)
    console.log(`[Server] Environment: ${config.nodeEnv}`)
  })
}

main().catch((err) => {
  console.error('[Fatal]', err)
  process.exit(1)
})

