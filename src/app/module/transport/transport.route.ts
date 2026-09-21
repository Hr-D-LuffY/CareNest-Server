import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { TransportController } from './transport.controller'

const router = Router()

// Vehicle registry. These come before /:id so "vehicles" is not read as a transport id.
router.post('/vehicles', auth(Role.STAFF), TransportController.createVehicle)
router.get('/vehicles/me', auth(Role.STAFF), TransportController.listMyVehicles)
// Any logged-in user: guardians pick a vehicle from here when requesting a ride.
router.get('/vehicles', auth(), TransportController.listVehicles)
router.patch('/vehicles/:id', auth(Role.STAFF), TransportController.updateVehicle)
router.delete('/vehicles/:id', auth(Role.STAFF), TransportController.deleteVehicle)

router.post('/', auth(Role.GUARDIAN), TransportController.createTransport)
router.get('/', auth(Role.GUARDIAN), TransportController.listMyTransport)
router.get('/:id', auth(Role.GUARDIAN), TransportController.getMyTransport)
router.delete('/:id', auth(Role.GUARDIAN), TransportController.cancelTransport)

router.post('/:id/start', auth(Role.STAFF), TransportController.startTrip)
router.post('/:id/end', auth(Role.STAFF), TransportController.endTrip)

export const TransportRoutes = router
