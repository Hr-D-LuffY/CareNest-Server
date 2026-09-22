import app from './app'
import { config } from './app/config'
import { prisma } from './app/lib/prisma'

const main = async () => {
  await prisma.$connect()
  console.log('Database connected')

  app.listen(config.port, () => {
    console.log(`CareNest server listening on port ${config.port}`)
  })
}

main().catch(async (error) => {
  console.error('Failed to start server:', error)
  await prisma.$disconnect()
  process.exit(1)
})
