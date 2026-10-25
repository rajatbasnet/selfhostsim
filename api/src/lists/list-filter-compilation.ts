import { FilterQuery } from 'mongoose'
import { Contact } from '../contacts/schemas/contact.schema'

/**
 * The only filter shape a dynamic list may carry. Mirrors
 * ContactList.filter in the schema.
 */
export interface ListFilter {
  tagsInclude?: string[]
  tagsExclude?: string[]
  hasPhone?: boolean
  hasEmail?: boolean
  smsConsent?: boolean
  emailConsent?: boolean
  createdAfter?: Date
  createdBefore?: Date
}

export const LIST_FILTER_KEYS: ReadonlyArray<keyof ListFilter> = [
  'tagsInclude',
  'tagsExclude',
  'hasPhone',
  'hasEmail',
  'smsConsent',
  'emailConsent',
  'createdAfter',
  'createdBefore',
]

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Keeps only non-empty strings, trimmed and deduplicated. */
function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

/** Accepts a Date, an ISO string or epoch millis. Anything else is dropped. */
function sanitizeDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  return undefined
}

/**
 * Reduces an arbitrary client object to the documented ListFilter shape,
 * dropping unknown keys and wrongly-typed values. Use this before persisting
 * a dynamic list's filter so the stored document is already clean.
 */
export function normalizeListFilter(input: unknown): ListFilter {
  const filter: ListFilter = {}
  if (!isPlainObject(input)) return filter

  const tagsInclude = sanitizeStringArray(input.tagsInclude)
  if (tagsInclude.length) filter.tagsInclude = tagsInclude

  const tagsExclude = sanitizeStringArray(input.tagsExclude)
  if (tagsExclude.length) filter.tagsExclude = tagsExclude

  for (const key of [
    'hasPhone',
    'hasEmail',
    'smsConsent',
    'emailConsent',
  ] as const) {
    if (typeof input[key] === 'boolean') filter[key] = input[key] as boolean
  }

  const createdAfter = sanitizeDate(input.createdAfter)
  if (createdAfter) filter.createdAfter = createdAfter

  const createdBefore = sanitizeDate(input.createdBefore)
  if (createdBefore) filter.createdBefore = createdBefore

  return filter
}

/**
 * Compiles a dynamic list filter into a Mongoose query fragment on Contact.
 *
 * Only the documented ListFilter keys are honoured; everything else is
 * ignored, and every value is re-typed here, so a client can never smuggle
 * an operator (`{ $where: ... }`, `{ tags: { $ne: null } }`) into the query.
 *
 * The result is NOT scoped to a user. Callers must add `user: user._id`.
 */
export function compileListFilter(filter: unknown): FilterQuery<Contact> {
  const clean = normalizeListFilter(filter)
  const query: FilterQuery<Contact> = {}

  if (clean.tagsInclude || clean.tagsExclude) {
    const tags: Record<string, string[]> = {}
    if (clean.tagsInclude) tags.$in = clean.tagsInclude
    if (clean.tagsExclude) tags.$nin = clean.tagsExclude
    query.tags = tags
  }

  if (clean.hasPhone === true) query.phone = { $nin: [null, ''] }
  if (clean.hasPhone === false) query.phone = { $in: [null, ''] }

  if (clean.hasEmail === true) query.email = { $nin: [null, ''] }
  if (clean.hasEmail === false) query.email = { $in: [null, ''] }

  if (clean.smsConsent !== undefined) query.smsConsent = clean.smsConsent
  if (clean.emailConsent !== undefined) query.emailConsent = clean.emailConsent

  if (clean.createdAfter || clean.createdBefore) {
    const createdAt: Record<string, Date> = {}
    if (clean.createdAfter) createdAt.$gte = clean.createdAfter
    if (clean.createdBefore) createdAt.$lte = clean.createdBefore
    query.createdAt = createdAt
  }

  return query
}
