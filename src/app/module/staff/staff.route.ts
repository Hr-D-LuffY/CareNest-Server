import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { StaffController } from './staff.controller'

const router = Router()

router.get('/me', auth(Role.STAFF), StaffController.getMyProfile)
router.patch('/me', auth(Role.STAFF), StaffController.updateMyProfile)

export const StaffRoutes = router
