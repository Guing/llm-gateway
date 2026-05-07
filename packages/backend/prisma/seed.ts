import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('[Seed] Starting...')

  // Create admin user
  const adminEmail = 'admin@gateway.local'
  const adminPassword = 'admin123'

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (!existing) {
    const hashed = await bcrypt.hash(adminPassword, 12)
    await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashed,
        role: 'admin',
      },
    })
    console.log(`[Seed] Admin user created: ${adminEmail} / ${adminPassword}`)
  } else {
    console.log('[Seed] Admin user already exists, skipping.')
  }

  console.log('[Seed] Done.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
