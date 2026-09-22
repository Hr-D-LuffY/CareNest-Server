import { Router } from 'express'
import { Role } from '../../../generated/prisma/enums'
import { auth } from '../../middleware/checkAuth'
import { RatingController } from './rating.controller'

const router = Router()

router.post('/', auth(Role.GUARDIAN), RatingController.createRating)

export const RatingRoutes = router

const staffRatingsRouter = Router()

staffRatingsRouter.get('/:id/ratings', auth(), RatingController.getStaffRatings)

export const StaffRatingRoutes = staffRatingsRouter
