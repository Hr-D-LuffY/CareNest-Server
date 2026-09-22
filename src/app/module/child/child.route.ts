import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { uploadImage } from '../../middleware/upload'
import { ChildController } from './child.controller'

const router = Router()

router.post('/', auth(Role.GUARDIAN), ChildController.createChild)
router.get('/', auth(Role.GUARDIAN), ChildController.listMyChildren)
router.get('/:id', auth(Role.GUARDIAN), ChildController.getMyChild)
router.patch('/:id', auth(Role.GUARDIAN), ChildController.updateMyChild)
router.delete('/:id', auth(Role.GUARDIAN), ChildController.deleteMyChild)
router.post(
  '/:id/photo',
  auth(Role.GUARDIAN),
  uploadImage.single('photo'),
  ChildController.uploadChildPhoto,
)

export const ChildRoutes = router
