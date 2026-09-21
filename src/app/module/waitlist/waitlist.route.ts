import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { WaitlistController } from './waitlist.controller'

const router = Router()

// Mounted under /room, so this is GET /room/:id/waitlist (SRS section 6).
router.get('/:id/waitlist', auth(Role.STAFF, Role.ADMIN), WaitlistController.listRoomWaitlist)

export const WaitlistRoutes = router
