import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { BookingController } from './booking.controller'

const router = Router()

router.post('/', auth(Role.GUARDIAN), BookingController.createBooking)

export const BookingRoutes = router
