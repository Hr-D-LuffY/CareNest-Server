import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { BookingController } from './booking.controller'

const router = Router()

router.post('/', auth(Role.GUARDIAN), BookingController.createBooking)
router.get('/', auth(Role.GUARDIAN), BookingController.listMyBookings)
router.get('/:id', auth(Role.GUARDIAN), BookingController.getMyBooking)
router.delete('/:id', auth(Role.GUARDIAN), BookingController.cancelBooking)
router.post('/:id/check-in', auth(Role.STAFF), BookingController.checkIn)
router.post('/:id/check-out', auth(Role.STAFF), BookingController.checkOut)

export const BookingRoutes = router
