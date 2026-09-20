import type { TokenPayload } from '../utils/jwt'

declare global {
  namespace Express {
    interface Request {
      // Set by auth(); the small shape services receive instead of the request itself.
      user?: TokenPayload
    }
  }
}
