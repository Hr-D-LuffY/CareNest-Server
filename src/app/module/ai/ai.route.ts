import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { AiController } from './ai.controller'

const router = Router()

router.post('/chat', auth(Role.GUARDIAN), AiController.chat)

export const AiRoutes = router
