import { v2 as cloudinary } from 'cloudinary'
import { config } from '../config'

// CLOUDINARY_URL is cloudinary://<api_key>:<api_secret>@<cloud_name>; the SDK can auto-read it from
// process.env, but application code never reads process.env directly here, so it's parsed from the
// already-validated config value instead.
const { username: apiKey, password: apiSecret, hostname: cloudName } = new URL(config.cloudinaryUrl)
cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true })

export const uploadImageBuffer = (buffer: Buffer, folder: string) =>
  new Promise<{ url: string; publicId: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary upload failed'))
          return
        }
        resolve({ url: result.secure_url, publicId: result.public_id })
      },
    )
    stream.end(buffer)
  })

// Best-effort: a failed cleanup of the old image must never block the new one from being saved.
export const deleteImage = async (publicId: string) => {
  try {
    await cloudinary.uploader.destroy(publicId)
  } catch (error) {
    console.error(`Cloudinary delete(${publicId}) failed, the old image will stay orphaned:`, error)
  }
}
