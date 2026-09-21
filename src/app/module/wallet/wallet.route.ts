import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { WalletController } from './wallet.controller'

const router = Router()

router.get('/transactions', auth(Role.GUARDIAN), WalletController.listMyTransactions)

export const WalletRoutes = router
