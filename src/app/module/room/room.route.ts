import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { RoomController } from './room.controller'

const router = Router()

router.post('/', auth(Role.ADMIN), RoomController.createRoom)
// Any logged-in user browses rooms. /search must come before /:id or "search" is read as an id.
router.get('/', auth(), RoomController.listRooms)
router.get('/search', auth(), RoomController.searchRooms)
router.get('/:id', auth(), RoomController.getRoom)
router.patch('/:id', auth(Role.ADMIN), RoomController.updateRoom)
router.delete('/:id', auth(Role.ADMIN), RoomController.deleteRoom)

export const RoomRoutes = router
