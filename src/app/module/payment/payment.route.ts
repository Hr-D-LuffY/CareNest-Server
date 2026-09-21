import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { PaymentController } from './payment.controller'

const router = Router()

router.post('/top-up', auth(Role.GUARDIAN), PaymentController.initiateTopUp)
router.get('/bkash/callback', PaymentController.handleBkashCallback)
router.get('/:id', auth(Role.GUARDIAN), PaymentController.getMyPayment)

export const PaymentRoutes = router
