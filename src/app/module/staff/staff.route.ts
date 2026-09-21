import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { StaffController } from './staff.controller'

const router = Router()

router.get('/me', auth(Role.STAFF), StaffController.getMyProfile)
router.patch('/me', auth(Role.STAFF), StaffController.updateMyProfile)

router.post('/availability', auth(Role.STAFF), StaffController.createMySlot)
router.patch('/availability/:id', auth(Role.STAFF), StaffController.updateMySlot)
router.delete('/availability/:id', auth(Role.STAFF), StaffController.deleteMySlot)
// Any logged-in user: guardians and admins need it to see when staff can run a room.
router.get('/:id/availability', auth(), StaffController.listStaffSlots)

export const StaffRoutes = router
