import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { rateLimiter } from '../../middleware/rateLimiter'
import { AiController } from './ai.controller'

const FIFTEEN_MINUTES_IN_SECONDS = 15 * 60

// A refresh skips the 15-minute cache and spends provider quota, so it gets its own small cap.
const refreshLimiter = rateLimiter({
  windowSeconds: FIFTEEN_MINUTES_IN_SECONDS,
  max: 5,
  keyPrefix: 'ai-insights-refresh',
})

const router = Router()

router.post('/chat', auth(Role.GUARDIAN), AiController.chat)
router.get(
  '/insights',
  auth(Role.ADMIN),
  (req, res, next) => (req.query.refresh === 'true' ? refreshLimiter(req, res, next) : next()),
  AiController.getInsights,
)
router.get('/status', auth(Role.ADMIN), AiController.getStatus)

export const AiRoutes = router
