import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { RoomController } from './room.controller'

const router = Router()

router.post('/', auth(Role.ADMIN), RoomController.createRoom)
router.patch('/:id', auth(Role.ADMIN), RoomController.updateRoom)
router.delete('/:id', auth(Role.ADMIN), RoomController.deleteRoom)

export const RoomRoutes = router
