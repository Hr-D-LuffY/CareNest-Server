import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import helmet from 'helmet'
import httpStatus from 'http-status'
import { config } from './app/config'
import { globalErrorHandler } from './app/middleware/globalErrorHandler'
import { notFound } from './app/middleware/notFound'
import { rateLimiter } from './app/middleware/rateLimiter'
import { AdminRoutes } from './app/module/admin/admin.route'
import { AuthRoutes } from './app/module/auth/auth.route'
import { BookingRoutes } from './app/module/booking/booking.route'
import { ChildRoutes } from './app/module/child/child.route'
import { GuardianRoutes } from './app/module/guardian/guardian.route'
import { PaymentRoutes } from './app/module/payment/payment.route'
import { RatingRoutes, StaffRatingRoutes } from './app/module/rating/rating.route'
import { RoomRoutes } from './app/module/room/room.route'
import { StaffRoutes } from './app/module/staff/staff.route'
import { TransportRoutes } from './app/module/transport/transport.route'
import { WaitlistRoutes } from './app/module/waitlist/waitlist.route'
import { WalletRoutes } from './app/module/wallet/wallet.route'
import { sendResponse } from './app/utils/sendResponse'

const FIFTEEN_MINUTES_IN_SECONDS = 15 * 60

// Generous ceiling for ordinary API traffic — this guards against abuse/DoS, not normal browsing.
const GENERAL_RATE_LIMIT = { windowSeconds: FIFTEEN_MINUTES_IN_SECONDS, max: 300 }

// Auth endpoints (login, register, google, refresh-token) are brute-force targets, so they get a
// much tighter cap than general API traffic.
const AUTH_RATE_LIMIT = { windowSeconds: FIFTEEN_MINUTES_IN_SECONDS, max: 20 }

const app = express()

app.use(helmet())
app.use(cors({ origin: config.frontendUrl, credentials: true }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(rateLimiter({ ...GENERAL_RATE_LIMIT, keyPrefix: 'general' }))

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

app.use('/api/v1/auth', rateLimiter({ ...AUTH_RATE_LIMIT, keyPrefix: 'auth' }), AuthRoutes)
app.use('/api/v1/guardian', GuardianRoutes)
app.use('/api/v1/child', ChildRoutes)
app.use('/api/v1/room', RoomRoutes)
app.use('/api/v1/room', WaitlistRoutes)
app.use('/api/v1/booking', BookingRoutes)
app.use('/api/v1/payment', PaymentRoutes)
app.use('/api/v1/wallet', WalletRoutes)
app.use('/api/v1/transport', TransportRoutes)
app.use('/api/v1/staff', StaffRoutes)
app.use('/api/v1/staff', StaffRatingRoutes)
app.use('/api/v1/rating', RatingRoutes)
app.use('/api/v1/admin', AdminRoutes)

app.use(notFound)
app.use(globalErrorHandler)

export default app
