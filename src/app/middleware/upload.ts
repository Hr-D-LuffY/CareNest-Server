import httpStatus from 'http-status'
import multer from 'multer'
import { AppError } from '../errorHelpers/AppError'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

// Memory storage: the buffer goes straight to Cloudinary, nothing touches this server's disk
// (important on Render, where the filesystem is ephemeral).
export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    // MulterError's message is a fixed lookup by code, not a custom string — AppError carries the
    // real message through to globalErrorHandler instead.
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new AppError(httpStatus.BAD_REQUEST, 'Only JPEG, PNG or WEBP images are allowed'))
      return
    }
    cb(null, true)
  },
})
