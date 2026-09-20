import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { GuardianController } from './guardian.controller'

const router = Router()

router.get('/me', auth(Role.GUARDIAN), GuardianController.getMyProfile)
router.patch('/me', auth(Role.GUARDIAN), GuardianController.updateMyProfile)
router.delete('/me', auth(Role.GUARDIAN), GuardianController.deleteMyAccount)

export const GuardianRoutes = router
