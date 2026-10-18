import { z } from 'zod'
import { BookingStatus, DayOfWeek, Tier, WaitlistStatus } from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { BookingService } from '../../module/booking/booking.service'
import { ChildService } from '../../module/child/child.service'
import { GuardianService } from '../../module/guardian/guardian.service'
import { RoomService } from '../../module/room/room.service'
import { WaitlistService } from '../../module/waitlist/waitlist.service'
import { WalletService } from '../../module/wallet/wallet.service'
import { toIsoDate } from '../../utils/date'
import type { TokenPayload } from '../../utils/jwt'
import type { ToolDefinition } from './ai.types'

// What the care assistant may look up. Every tool is read-only and goes through the same service a
// guardian's own API call would, so ownership checks stay in one place and the model can only ever
// see the caller's data. Nothing here books, cancels or pays.
//
// Privacy: free-tier providers may log prompts, so results are trimmed to what the answer needs.
// A child is a first name, tier and age; never allergies, conditions, emergency contacts, date of
// birth or phone/email. Results are also kept short, because the free plans are token-limited.

export type AssistantCaller = Pick<TokenPayload, 'userId' | 'role'>

// A room as the chat endpoint will show it. Built here from the service result, so the ids and dates
// the reply links to come from the database and never from the model.
export interface AssistantRoom {
  id: string
  name: string
  tier: Tier
  dayOfWeek: DayOfWeek
  startTime: string
  endTime: string
  sessionDate: string
  seatsLeft: number
}

export interface ToolOutput {
  // Compact JSON handed back to the model as the tool message.
  content: string
  // Set by search_rooms; the chat endpoint shows the latest search as room cards.
  rooms: AssistantRoom[]
  // Set by get_my_children; with exactly one child a booking link can pre-select them.
  childIds: string[]
}

interface AssistantTool<Schema extends z.ZodType> {
  name: string
  description: string
  schema: Schema
  run: (
    caller: AssistantCaller,
    args: z.infer<Schema>,
  ) => Promise<{ data: unknown; rooms?: AssistantRoom[]; childIds?: string[] }>
}

const MAX_ROOM_RESULTS = 5
const MAX_LIST_RESULTS = 5
const MAX_CHILDREN = 10
const RECENT_TRANSACTIONS = 3
const FIRST_PAGE = 1
const MONTHS_PER_YEAR = 12

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'That is not a real date')
  .describe('A calendar date, YYYY-MM-DD')

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ''

const ageInYears = (dateOfBirth: Date, today = new Date()) => {
  const months =
    (today.getUTCFullYear() - dateOfBirth.getUTCFullYear()) * MONTHS_PER_YEAR +
    (today.getUTCMonth() - dateOfBirth.getUTCMonth()) -
    (today.getUTCDate() < dateOfBirth.getUTCDate() ? 1 : 0)
  return Math.max(0, Math.floor(months / MONTHS_PER_YEAR))
}

// Only here so TypeScript infers each tool's argument type from its own schema.
const defineTool = <Schema extends z.ZodType>(tool: AssistantTool<Schema>) => tool

const searchRooms = defineTool({
  name: 'search_rooms',
  description:
    'Find care rooms and how many seats are left. Rooms repeat weekly; give a date to check a specific day, otherwise each room reports its next session.',
  schema: z.object({
    date: isoDate.optional(),
    dayOfWeek: z.enum(DayOfWeek).optional(),
    tier: z.enum(Tier).optional(),
    availability: z.enum(['AVAILABLE', 'FULL']).optional(),
    keyword: z.string().trim().min(1).max(50).optional().describe('Part of a room or sitter name'),
  }),
  run: async (_caller, { date, dayOfWeek, tier, availability, keyword }) => {
    const { items } = await RoomService.listRooms({
      page: FIRST_PAGE,
      limit: MAX_ROOM_RESULTS,
      sortBy: 'startTime',
      sortOrder: 'asc',
      ...(date && { date: new Date(date) }),
      ...(dayOfWeek && { dayOfWeek }),
      ...(tier && { tier }),
      ...(availability && { status: availability }),
      ...(keyword && { q: keyword }),
    })
    const rooms = items.map((room) => ({
      id: room.id,
      name: room.name,
      tier: room.tier,
      dayOfWeek: room.dayOfWeek,
      startTime: room.startTime,
      endTime: room.endTime,
      sessionDate: room.sessionDate,
      seatsLeft: room.seatsLeft,
    }))
    return { data: { rooms }, rooms }
  },
})

const getMyChildren = defineTool({
  name: 'get_my_children',
  description: "List the guardian's children (first name, tier and age only).",
  schema: z.object({}),
  run: async ({ userId }) => {
    const { items } = await ChildService.listMyChildren(
      { userId },
      { page: FIRST_PAGE, limit: MAX_CHILDREN, sortBy: 'createdAt', sortOrder: 'asc' },
    )
    return {
      childIds: items.map((child) => child.id),
      data: {
        children: items.map((child) => ({
          id: child.id,
          firstName: firstName(child.name),
          tier: child.tier,
          ageYears: ageInYears(child.dateOfBirth),
        })),
      },
    }
  },
})

const getMyBookings = defineTool({
  name: 'get_my_bookings',
  description: "List the guardian's most recent bookings, optionally only one status.",
  schema: z.object({ status: z.enum(BookingStatus).optional() }),
  run: async ({ userId }, { status }) => {
    const { items } = await BookingService.listMyBookings(
      { userId },
      { page: FIRST_PAGE, limit: MAX_LIST_RESULTS, ...(status && { status }) },
    )
    return {
      data: {
        bookings: items.map((booking) => ({
          id: booking.id,
          status: booking.status,
          sessionDate: booking.sessionDate,
          room: booking.room.name,
          startTime: booking.room.startTime,
          endTime: booking.room.endTime,
          child: firstName(booking.child.name),
          estimatedFee: booking.estimatedFee,
          finalFee: booking.finalFee,
        })),
      },
    }
  },
})

const getMyWaitlist = defineTool({
  name: 'get_my_waitlist',
  description: "List the guardian's most recent waitlist entries, optionally only one status.",
  schema: z.object({ status: z.enum(WaitlistStatus).optional() }),
  run: async (caller, { status }) => {
    const { items } = await WaitlistService.listMyWaitlist(caller, {
      page: FIRST_PAGE,
      limit: MAX_LIST_RESULTS,
      ...(status && { status }),
    })
    return {
      data: {
        waitlist: items.map((entry) => ({
          status: entry.status,
          sessionDate: entry.sessionDate,
          room: entry.room.name,
          child: firstName(entry.child.name),
        })),
      },
    }
  },
})

const getWallet = defineTool({
  name: 'get_wallet',
  description: "Get the guardian's wallet balance and the last few transactions.",
  schema: z.object({}),
  run: async ({ userId }) => {
    const [profile, { items }] = await Promise.all([
      GuardianService.getMyProfile({ userId }),
      WalletService.listMyTransactions(
        { userId },
        { page: FIRST_PAGE, limit: RECENT_TRANSACTIONS },
      ),
    ])
    return {
      data: {
        balance: profile.guardianProfile?.walletBalance,
        recentTransactions: items.map(({ type, amount, description, createdAt }) => ({
          type,
          amount,
          description,
          date: toIsoDate(createdAt),
        })),
      },
    }
  },
})

const tools = [searchRooms, getMyChildren, getMyBookings, getMyWaitlist, getWallet]

// Providers want a bare JSON Schema object; Zod adds `$schema` and `additionalProperties`.
const toParameters = (schema: z.ZodType) => {
  const { $schema, additionalProperties, ...parameters } = z.toJSONSchema(schema, { io: 'input' })
  return parameters
}

export const ASSISTANT_TOOL_DEFINITIONS: ToolDefinition[] = tools.map(
  ({ name, description, schema }) => ({ name, description, parameters: toParameters(schema) }),
)

const toolsByName = new Map<string, (typeof tools)[number]>(tools.map((tool) => [tool.name, tool]))

const fail = (message: string): ToolOutput => ({
  content: JSON.stringify({ error: message }),
  rooms: [],
  childIds: [],
})

// Runs one tool call from the model. A bad call (unknown tool, arguments that don't match the
// schema, or a service saying no) becomes an `error` result the model can read and recover from,
// rather than an exception that ends the whole chat. Anything unexpected still throws.
export const runAssistantTool = async (
  caller: AssistantCaller,
  name: string,
  rawArguments: string,
): Promise<ToolOutput> => {
  const tool = toolsByName.get(name)
  if (!tool) return fail(`Unknown tool: ${name}`)

  let args: unknown
  try {
    args = rawArguments.trim() ? JSON.parse(rawArguments) : {}
  } catch {
    return fail('Tool arguments must be valid JSON')
  }

  const parsed = tool.schema.safeParse(args)
  if (!parsed.success) {
    return fail(parsed.error.issues.map((issue) => issue.message).join('; '))
  }

  try {
    // The map erases each tool's own argument type; the schema above has just validated it.
    const { data, rooms = [], childIds = [] } = await tool.run(caller, parsed.data as never)
    return { content: JSON.stringify(data), rooms, childIds }
  } catch (error) {
    if (error instanceof AppError) return fail(error.message)
    throw error
  }
}

// True when the model asked for a tool we have, with arguments that are at least JSON. This is the
// gateway's "unparsable tool call" check: a call that fails it moves on to the next provider, while
// arguments that parse but break the schema go back to the model as an error it can fix.
export const isUsableToolCall = (name: string, rawArguments: string) => {
  if (!toolsByName.has(name)) return false
  if (!rawArguments.trim()) return true
  try {
    JSON.parse(rawArguments)
    return true
  } catch {
    return false
  }
}
