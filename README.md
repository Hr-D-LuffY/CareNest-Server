# CareNest <small>— Trusted care for your little ones</small>

A backend platform for booking supervised childcare and transport — guardians enroll children into verified staff-run care sessions, pay through a real wallet-and-gateway system, and get a fair shot at a full room through a weighted waitlist instead of losing their spot outright.

## Problem Statement

Parents and guardians who need short- or long-term supervised childcare — with transport to and from a session — are usually stuck piecing it together informally: a sitter found through a group chat, no visibility into whether a room actually has space, no fair process when it doesn't, and no single record of who was paid, when, or for what. Verifying that the person looking after a child is actually who they say they are is left to word of mouth. When a session is full, the common answer is simply "try again later," with no guarantee the next opening goes to whoever has waited longest or needs it most.

## Our Solution

CareNest is a REST API that gives this process real structure. Guardians register, add their children's profiles (including medical and emergency-contact information), and browse care "rooms" run by admin-verified staff. Booking a seat draws from an in-app wallet that is only ever topped up through a real payment gateway — never simulated — and every wallet movement is tied to an auditable ledger entry.

When a room is full, a booking request doesn't fail — it joins a waitlist ranked by a weighted priority score (how long they've waited, the child's care tier, and the guardian's recent cancellation history), and the top-ranked entry is automatically promoted into a confirmed seat the instant a cancellation frees one up. Staff accounts — sitters and drivers — are created only by an administrator and must be verified, including a review of an uploaded ID document, before they can run a room or accept a ride. Every check-in, fee, cancellation, and role change is written to an audit trail, so nothing that affects money or a child's safety happens invisibly.

## Key Features

- **Weighted waitlist priority engine** — re-ranks and auto-promotes queued bookings the moment a seat is cancelled, instead of first-come-first-served
- **Real wallet payments** via bKash Tokenized Checkout, credited only after the backend independently confirms the transaction with the gateway — never on the redirect alone
- **Three-role access control** — Guardian, Staff (Sitter / Driver / Both), and Admin — enforced on every protected route, with JWT access/refresh tokens and Google OAuth sign-in
- **Admin-vetted staff onboarding**, including a reviewable ID-document upload, before a staff member can be assigned to a room or accept a trip
- **Supervised transport booking** tied to an existing care session, with trip start/end logging and automatic fare deduction
- **Redis-backed seat-availability caching and API rate limiting**, with automatic fail-open behavior if Redis is unavailable
- **Ratings, admin analytics, and a full audit log** covering staff verification, role changes, booking status changes, and wallet movements
- **Soft deletes throughout** — guardians, children, rooms, and staff profiles are deactivated, never destroyed, so financial and medical history is preserved

## Tech Stack

| Category | Technology |
|---|---|
| Runtime | Node.js, TypeScript |
| Framework | Express.js 5 |
| Database | PostgreSQL |
| ORM | Prisma 7 (via `@prisma/adapter-pg`) |
| Validation | Zod |
| Authentication | JWT (access + refresh tokens), Google OAuth |
| Caching & Rate Limiting | Redis |
| Payments | bKash Tokenized Checkout |
| File Storage | Cloudinary, Multer |
| Security | Helmet, bcrypt, CORS |
| Linting & Formatting | Biome |
| Dev Runtime | tsx |
| Production Bundler | tsup |

## Getting Started

### Prerequisites

- Node.js 20 or later
- npm
- PostgreSQL 14 or later
- Redis (optional — the API runs without it, with caching and rate limiting disabled)

### Installation

```bash
# Clone the repository
git clone https://github.com/Hr-D-LuffY/CareNest-Server.git
cd CareNest-Server

# Install dependencies
npm install

# Copy the environment template and fill in real values
cp .env.example .env

# Generate the Prisma client and apply migrations
npx prisma generate
npx prisma migrate dev

# Seed a demo Admin account and sample rooms/staff
npx prisma db seed
```

### Environment Variables

Set these in `.env` (see `.env.example` for the full template):

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Runtime environment (`development`, `production`, `test`) |
| `PORT` | Port the HTTP server listens on |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Signing secret for access tokens |
| `JWT_REFRESH_SECRET` | Signing secret for refresh tokens |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime (e.g. `15m`) |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime (e.g. `7d`) |
| `BCRYPT_SALT_ROUNDS` | Password hashing cost factor |
| `FRONTEND_URL` | Allowed CORS origin |
| `REDIS_URL` | Redis connection string (optional) |
| `BKASH_BASE_URL` | bKash Tokenized Checkout API base URL |
| `BKASH_USERNAME` / `BKASH_PASSWORD` | bKash merchant API credentials |
| `BKASH_APP_KEY` / `BKASH_APP_SECRET` | bKash merchant app credentials |
| `BKASH_CALLBACK_URL` | Publicly reachable URL bKash redirects to after checkout |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `CLOUDINARY_URL` | Cloudinary connection string for file uploads |

### Running the Project

```bash
# Start the development server (auto-reload)
npm run dev

# Build for production
npm run build

# Run the production build
npm run start
```

The API is available at `http://localhost:5000/api/v1` by default.

### Demo Credentials

`npx prisma db seed` creates a demo Administrator account for evaluation, along with sample verified staff and rooms:

| Field | Value |
|---|---|
| Email | `admin@carenest.com` |
| Password | `CareNest@Admin2026` |

## Usage / API Overview

Every response follows a consistent envelope:

```json
// Success
{ "success": true, "message": "Operation successful", "data": {} }

// Error
{ "success": false, "message": "Something went wrong", "errors": [] }
```

All routes are versioned under `/api/v1` and require a `Authorization: Bearer <token>` header unless marked public. A full, runnable Postman collection covering every endpoint — with example requests, responses, and chained authentication — is included at [`postman/CareNest.postman_collection.json`](postman/CareNest.postman_collection.json).

**Full API Documentation:** _add your published Postman documentation link here (Collection → "..." → View Documentation → Publish)._

### Endpoint Groups

| Group | Examples |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/google`, `POST /auth/refresh-token` |
| Guardian | `GET/PATCH/DELETE /guardian/me`, `POST /guardian/me/photo` |
| Child | `POST/GET/PATCH/DELETE /child`, `POST /child/:id/photo` |
| Room | `POST/GET/PATCH/DELETE /room`, `GET /room/search` |
| Booking | `POST /booking`, `GET /booking`, `DELETE /booking/:id`, `POST /booking/:id/check-in`, `POST /booking/:id/check-out` |
| Waitlist | `GET /room/:id/waitlist` |
| Staff | `GET/PATCH /staff/me`, `POST /staff/availability`, `GET /staff/me/earnings` |
| Transport | `POST /transport`, `POST /transport/vehicles`, `POST /transport/:id/start`, `POST /transport/:id/end` |
| Rating | `POST /rating`, `GET /staff/:id/ratings` |
| Wallet & Payment | `GET /wallet/transactions`, `POST /payment/top-up`, `GET /payment/bkash/callback` |
| Admin | `POST /admin/staff`, `PATCH /admin/staff/:id/verify`, `GET /admin/dashboard-stats`, `GET /admin/audit-logs` |

### Example: Register a Guardian

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "name": "Ayesha Rahman",
  "email": "ayesha@example.com",
  "password": "SecurePass123",
  "phone": "01700000000",
  "address": "House 12, Road 5, Dhaka"
}
```

```json
{
  "success": true,
  "message": "Account registered successfully",
  "data": {
    "id": "b4c85b83-9cc4-41c1-9aed-8592ba00d11f",
    "name": "Ayesha Rahman",
    "email": "ayesha@example.com",
    "role": "GUARDIAN",
    "profilePhoto": null,
    "createdAt": "2026-09-22T10:03:32.505Z"
  }
}
```

### Example: Book a Seat (auto-waitlists a full room)

```http
POST /api/v1/booking
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "childId": "0074028c-1f46-4278-bd88-cde7ab2389fe",
  "roomId": "25798bdf-642d-4954-9157-994952222b4c",
  "sessionDate": "2026-09-28"
}
```

If a seat is available, the response is `201 Created` with the confirmed booking. If the room is full, the same request returns `202 Accepted` with a waitlist entry instead of failing:

```json
{
  "success": true,
  "message": "The room is full, so the child was added to the waitlist",
  "data": {
    "id": "390e90a7-42a2-4611-be7a-1439fa6eb92c",
    "sessionDate": "2026-09-28",
    "status": "PENDING",
    "priorityScore": 0.3,
    "joinedAt": "2026-09-22T10:15:52.775Z",
    "room": { "id": "25798bdf-642d-4954-9157-994952222b4c", "name": "Sunshine Room" },
    "child": { "id": "0074028c-1f46-4278-bd88-cde7ab2389fe", "name": "Kid One", "tier": "DAILY" }
  }
}
```

## Project Structure

```
src/
├── server.ts               # Connects to the database, then starts the HTTP server
├── app.ts                  # Express app: security headers, CORS, rate limiting, routes
└── app/
    ├── config/              # Env var loading and validation (Zod)
    ├── lib/                 # Shared singletons: Prisma client, Redis, Cloudinary, fare/wallet logic
    ├── middleware/           # Auth guard, rate limiter, error handler, upload handling
    ├── utils/                # catchAsync, JWT helpers, pagination, response envelope
    └── module/
        ├── auth/             # Registration, login, refresh, Google OAuth
        ├── guardian/         # Guardian self-service profile
        ├── child/            # Child profiles
        ├── staff/            # Staff self-service, availability
        ├── room/             # Room management and seat availability
        ├── booking/          # Booking, check-in/check-out
        ├── waitlist/         # Waitlist priority engine
        ├── payment/          # bKash top-up and callback
        ├── transport/        # Vehicles and transport bookings
        ├── rating/           # Staff ratings
        └── admin/            # Staff verification, analytics, audit logs

prisma/
├── schema/                  # Split Prisma schema (one file per domain)
├── migrations/               # Versioned SQL migrations
└── seed.ts                   # Demo Admin, sample staff, and rooms

postman/
└── CareNest.postman_collection.json   # Full, runnable API collection
```

