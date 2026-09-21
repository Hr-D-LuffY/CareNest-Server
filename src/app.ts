import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import httpStatus from 'http-status'
import { globalErrorHandler } from './app/middleware/globalErrorHandler'
import { notFound } from './app/middleware/notFound'
import { AdminRoutes } from './app/module/admin/admin.route'
import { AuthRoutes } from './app/module/auth/auth.route'
import { BookingRoutes } from './app/module/booking/booking.route'
import { ChildRoutes } from './app/module/child/child.route'
import { GuardianRoutes } from './app/module/guardian/guardian.route'
import { RoomRoutes } from './app/module/room/room.route'
import { StaffRoutes } from './app/module/staff/staff.route'
import { WaitlistRoutes } from './app/module/waitlist/waitlist.route'
import { sendResponse } from './app/utils/sendResponse'

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

app.get('/health', (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'CareNest server is running',
    data: {},
  })
})

app.get('/', (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Welcome to CareNest-Trusted care for your little ones',
    data: {},
  })
})

app.use('/api/v1/auth', AuthRoutes)
app.use('/api/v1/guardian', GuardianRoutes)
app.use('/api/v1/child', ChildRoutes)
app.use('/api/v1/room', RoomRoutes)
app.use('/api/v1/room', WaitlistRoutes)
app.use('/api/v1/booking', BookingRoutes)
app.use('/api/v1/staff', StaffRoutes)
app.use('/api/v1/admin', AdminRoutes)

app.use(notFound)
app.use(globalErrorHandler)

export default app
