import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { AdminController } from './admin.controller'

const router = Router()

router.post('/staff', auth(Role.ADMIN), AdminController.createStaff)
router.get('/staff', auth(Role.ADMIN), AdminController.listStaff)
router.get('/staff/:id', auth(Role.ADMIN), AdminController.getStaff)
router.patch('/staff/:id', auth(Role.ADMIN), AdminController.updateStaff)
router.patch('/staff/:id/verify', auth(Role.ADMIN), AdminController.verifyStaff)
router.delete('/staff/:id', auth(Role.ADMIN), AdminController.deleteStaff)

router.get('/dashboard-stats', auth(Role.ADMIN), AdminController.getDashboardStats)
router.get('/audit-logs', auth(Role.ADMIN), AdminController.listAuditLogs)

export const AdminRoutes = router
