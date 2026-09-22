import { createClient } from 'redis'
import { config } from '../config'

const CONNECT_TIMEOUT_MS = 2000

const client = config.redisUrl
  ? createClient({
      url: config.redisUrl,
      socket: { reconnectStrategy: false, connectTimeout: CONNECT_TIMEOUT_MS },
    })
  : null

client?.on('error', (error) => console.error('Redis client error:', error))

let connecting: Promise<void> | null = null

const getConnectedClient = async () => {
  if (!client) return null
  if (!client.isOpen) {
    connecting ??= client.connect().then(() => undefined)
    await connecting
  }
  return client
}

export const redisGet = async (key: string): Promise<string | null> => {
  try {
    const connected = await getConnectedClient()
    return (await connected?.get(key)) ?? null
  } catch (error) {
    console.error(`Redis get(${key}) failed, falling back to the database:`, error)
    return null
  }
}

export const redisSet = async (key: string, value: string, ttlSeconds: number) => {
  try {
    const connected = await getConnectedClient()
    await connected?.set(key, value, { EX: ttlSeconds })
  } catch (error) {
    console.error(`Redis set(${key}) failed, continuing without caching this value:`, error)
  }
}

export const redisDel = async (key: string) => {
  try {
    const connected = await getConnectedClient()
    await connected?.del(key)
  } catch (error) {
    console.error(`Redis del(${key}) failed, the cached value will stay until it expires:`, error)
  }
}
