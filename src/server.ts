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

// On Vercel this file is imported as a serverless function, not run as a long-lived process —
// Vercel sets VERCEL=1 for every deployment, so we skip app.listen() there and just export the
// app; Vercel's Node runtime calls it directly as a (req, res) handler. Prisma connects lazily on
// first query in that case. Locally and on Render (a normal long-running process), main() runs.
if (!process.env.VERCEL) {
  main().catch(async (error) => {
    console.error('Failed to start server:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
}

export default app
