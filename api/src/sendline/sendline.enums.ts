/**
 * Shared vocabulary for the Sendline marketing layer.
 *
 * These values are persisted in MongoDB, so renaming a member is a data
 * migration, not a refactor.
 */

export enum Channel {
  SMS = 'sms',
  EMAIL = 'email',
}

/** Marketing is paced and consent-checked. Transactional is neither. */
export enum SendLane {
  MARKETING = 'marketing',
  TRANSACTIONAL = 'transactional',
}

export enum CampaignStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  SENDING = 'sending',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum SendStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  /** Resolved out of the audience before anything was dispatched. */
  SKIPPED = 'skipped',
}

/** Why a recipient was dropped during audience resolution. */
export enum SkipReason {
  SUPPRESSED = 'suppressed',
  NO_CONSENT = 'no_consent',
  DUPLICATE = 'duplicate',
  INVALID_ADDRESS = 'invalid_address',
  ALREADY_SENT = 'already_sent',
}

export enum SuppressionReason {
  STOP = 'stop',
  BOUNCE = 'bounce',
  COMPLAINT = 'complaint',
  MANUAL = 'manual',
}

export enum ContactListType {
  STATIC = 'static',
  DYNAMIC = 'dynamic',
}

/**
 * Inbound keywords that opt a person out. Matched case-insensitively against
 * the whole trimmed message body, never as a substring: "stop by tomorrow"
 * must not unsubscribe anyone.
 */
export const OPT_OUT_KEYWORDS = [
  'stop',
  'stopall',
  'unsubscribe',
  'quit',
  'end',
  'cancel',
  'optout',
  'opt-out',
] as const

/** Appended to outbound marketing SMS when the body does not already say it. */
export const SMS_OPT_OUT_NOTICE = 'Reply STOP to opt out.'

export const DEFAULT_PACING = {
  /** Messages released per minute. A human cannot type faster. */
  ratePerMinute: 10,
  /** Hard stop for a 24h window; the carrier's tolerance lives here. */
  dailyCap: 500,
  /** Local-time send window, inclusive start, exclusive end. */
  windowStartHour: 9,
  windowEndHour: 20,
  /** Random +/- jitter so the phone is never a perfect metronome. */
  jitterMs: 2000,
  timezone: 'UTC',
}
