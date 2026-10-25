import { Channel, SkipReason } from '../sendline/sendline.enums'

/**
 * Pure audience resolution. No Nest, no Mongo: hand it contacts and the two
 * exclusion sets and it tells you who gets a message and why the others do
 * not. Everything here is deterministic so a report can be reproduced.
 */

/**
 * The slice of a Contact this module reads. Structural so tests and callers
 * can pass plain objects; a Mongoose Contact document satisfies it.
 */
export interface AudienceContact {
  _id?: unknown
  name?: string
  phone?: string | null
  email?: string | null
  attributes?: Record<string, string>
  smsConsent?: boolean
  emailConsent?: boolean
  optedOutAt?: Date | string | null
}

export interface AudienceMember<C extends AudienceContact = AudienceContact> {
  contact: C
  /** Normalised address for the campaign channel. Null when there is none. */
  recipient: string | null
}

export interface SkippedMember<C extends AudienceContact = AudienceContact>
  extends AudienceMember<C> {
  reason: SkipReason
}

export interface EligibleMember<C extends AudienceContact = AudienceContact>
  extends AudienceMember<C> {
  recipient: string
}

export interface ResolveAudienceInput<C extends AudienceContact> {
  contacts: C[]
  channel: Channel
  /** Normalised addresses on the do-not-contact list for this channel. */
  suppressed?: Iterable<string> | null
  /** Normalised addresses this campaign has already produced a Send for. */
  alreadySentRecipients?: Iterable<string> | null
}

export interface ResolvedAudience<C extends AudienceContact> {
  eligible: EligibleMember<C>[]
  skipped: SkippedMember<C>[]
}

/**
 * The address a contact would be reached on for `channel`, normalised the same
 * way the suppression list stores it: trimmed, and lowercased for email. The
 * contacts module already writes canonical values, so this is a belt for the
 * braces, not a second normaliser.
 */
export function recipientForChannel(
  contact: AudienceContact,
  channel: Channel,
): string | null {
  const raw = channel === Channel.SMS ? contact.phone : contact.email
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.replace(/\s+/g, '')
  if (!trimmed) {
    return null
  }
  if (channel === Channel.EMAIL) {
    return trimmed.includes('@') ? trimmed.toLowerCase() : null
  }
  return /^\+\d{8,15}$/.test(trimmed) ? trimmed : null
}

/**
 * Consent for `channel`. An opt-out timestamp disqualifies regardless of the
 * per-channel flag: presence alone means no.
 */
export function hasConsentForChannel(
  contact: AudienceContact,
  channel: Channel,
): boolean {
  if (contact.optedOutAt) {
    return false
  }
  return channel === Channel.SMS
    ? contact.smsConsent === true
    : contact.emailConsent === true
}

function toSet(values?: Iterable<string> | null): Set<string> {
  if (!values) {
    return new Set()
  }
  if (values instanceof Set) {
    return values
  }
  return new Set(values)
}

/**
 * Splits `contacts` into eligible recipients and skipped ones, in input order.
 *
 * Each contact is tested against the rules in this fixed order and the first
 * failing rule is recorded as the reason:
 *   1. no usable address for the channel      -> INVALID_ADDRESS
 *   2. opted out, or no consent for channel   -> NO_CONSENT
 *   3. address is on the suppression list     -> SUPPRESSED
 *   4. address already seen earlier this run  -> DUPLICATE
 *   5. address already has a Send this campaign -> ALREADY_SENT
 *
 * The order matters for the report: a suppressed number that also lacks
 * consent is reported as NO_CONSENT, because that is the cheaper thing for the
 * operator to fix, and a duplicate is only a duplicate of an eligible row.
 */
export function resolveAudience<C extends AudienceContact>(
  input: ResolveAudienceInput<C>,
): ResolvedAudience<C> {
  const { contacts, channel } = input
  const suppressed = toSet(input.suppressed)
  const alreadySent = toSet(input.alreadySentRecipients)
  const seen = new Set<string>()

  const eligible: EligibleMember<C>[] = []
  const skipped: SkippedMember<C>[] = []

  for (const contact of contacts ?? []) {
    const recipient = recipientForChannel(contact, channel)

    if (!recipient) {
      skipped.push({
        contact,
        recipient: null,
        reason: SkipReason.INVALID_ADDRESS,
      })
      continue
    }
    if (!hasConsentForChannel(contact, channel)) {
      skipped.push({ contact, recipient, reason: SkipReason.NO_CONSENT })
      continue
    }
    if (suppressed.has(recipient)) {
      skipped.push({ contact, recipient, reason: SkipReason.SUPPRESSED })
      continue
    }
    if (seen.has(recipient)) {
      skipped.push({ contact, recipient, reason: SkipReason.DUPLICATE })
      continue
    }
    if (alreadySent.has(recipient)) {
      seen.add(recipient)
      skipped.push({ contact, recipient, reason: SkipReason.ALREADY_SENT })
      continue
    }

    seen.add(recipient)
    eligible.push({ contact, recipient })
  }

  return { eligible, skipped }
}

/** Counts skipped members per reason. Every reason is present, possibly 0. */
export function summarizeSkips(
  skipped: Array<{ reason: SkipReason }>,
): Record<SkipReason, number> {
  const summary = Object.values(SkipReason).reduce(
    (acc, reason) => {
      acc[reason] = 0
      return acc
    },
    {} as Record<SkipReason, number>,
  )
  for (const { reason } of skipped) {
    summary[reason] = (summary[reason] ?? 0) + 1
  }
  return summary
}
