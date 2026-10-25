// Shapes the Sendline API returns and accepts. The API (api/src/**) is the
// source of truth; every DTO here mirrors a controller or schema there.
// Fields the API may legitimately leave unset are optional, and every
// screen renders a plain-language fallback when one is missing.

/** api/src/sendline/sendline.enums.ts → Channel. There is no "both". */
export type Channel = 'sms' | 'email'

export interface Meta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface ListResponse<T> {
  data: T[]
  meta?: Meta
}

/* ---------- contacts (api/src/contacts) ---------- */

export interface Contact {
  _id: string
  name?: string
  phone?: string
  email?: string
  tags?: string[]
  attributes?: Record<string, string>
  smsConsent?: boolean
  emailConsent?: boolean
  consentSource?: string
  consentAt?: string
  optedOutAt?: string | null
  lastMessagedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

/** The chips on the Contacts page. */
export type ContactFilter = 'all' | 'sms_ok' | 'email_ok' | 'no_consent'

/** ListContactsQueryDTO.consent */
export type ConsentQuery = 'sms' | 'email' | 'any' | 'none'

/** ImportContactsSummaryDTO */
export interface ImportSummary {
  created?: number
  updated?: number
  skipped?: number
  skippedReasons?: Record<string, number>
}

/* ---------- lists (api/src/lists) ---------- */

/** ListFilterDTO: the only filter a dynamic list may carry. */
export interface ListFilter {
  tagsInclude?: string[]
  tagsExclude?: string[]
  hasPhone?: boolean
  hasEmail?: boolean
  smsConsent?: boolean
  emailConsent?: boolean
  createdAfter?: string
  createdBefore?: string
}

export interface ContactList {
  _id: string
  name: string
  type?: 'static' | 'dynamic'
  filter?: ListFilter | null
  contactIds?: string[]
  /** Only on GET /lists/:id. */
  memberCount?: number
  createdAt?: string
  updatedAt?: string
}

/* ---------- templates (api/src/templates) ---------- */

export interface Template {
  _id: string
  name: string
  slug?: string
  channel: Channel
  subject?: string
  body: string
  createdAt?: string
  updatedAt?: string
}

/* ---------- campaigns (api/src/campaigns) ---------- */

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'failed' | string

/** SendStatus: one row per recipient moves queued → sent → delivered | failed. */
export type SendStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'skipped'

/** SkipReason: why a recipient was dropped during audience resolution. */
export type SkipReason = 'suppressed' | 'no_consent' | 'duplicate' | 'invalid_address' | 'already_sent'

export interface CampaignStats {
  picked?: number
  queued?: number
  sent?: number
  delivered?: number
  failed?: number
  skipped?: number
  skippedByReason?: Record<string, number>
}

/** CampaignPacingDTO. Hours are whole local hours, 0–24. */
export interface CampaignPacing {
  ratePerMinute?: number
  dailyCap?: number
  windowStartHour?: number
  windowEndHour?: number
  timezone?: string
}

export interface Campaign {
  _id: string
  name: string
  channel: Channel
  /** MessageTemplate id (or the populated document). */
  template?: string | { _id: string; name?: string; body?: string; subject?: string }
  /** ContactList id (or the populated document). */
  list?: string | { _id: string; name?: string }
  /** Device id that sends the SMS. */
  device?: string | { _id: string } | null
  status: CampaignStatus
  scheduledAt?: string | null
  startedAt?: string | null
  completedAt?: string | null
  pacing?: CampaignPacing
  stats?: CampaignStats
  /** Set when status is failed. "Cancelled by user" after POST /cancel. */
  error?: string | null
  createdAt?: string
  updatedAt?: string
}

/** CreateCampaignDTO / UpdateCampaignDTO */
export interface CampaignInput {
  name: string
  channel: Channel
  template: string
  list: string
  device?: string
  scheduledAt?: string | null
  pacing?: CampaignPacing
}

/** CampaignPreviewSampleDTO */
export interface PreviewSample {
  contactId: string
  contactName: string
  recipient: string
  subject?: string
  body: string
  missingTags?: string[]
  segments?: { encoding: string; characters: number; segments: number }
}

/** CampaignPreviewDTO */
export interface CampaignPreview {
  campaignId?: string
  channel?: Channel
  audienceSize?: number
  eligibleCount?: number
  skippedCount?: number
  skippedByReason?: Record<string, number>
  samples?: PreviewSample[]
  segmentsPerMessage?: number
  totalSegments?: number
  estimatedDurationMs?: number
  estimatedCompletionAt?: string
  windowOpenNow?: boolean
  nextWindowOpeningAt?: string
  warnings?: string[]
}

/** One row of CampaignReport.failures */
export interface ReportFailure {
  sendId?: string
  contact?: { id: string; name?: string } | null
  recipient?: string
  errorCode?: string
  errorMessage?: string
  attempts?: number
  failedAt?: string
}

/** GET /campaigns/:id/report */
export interface CampaignReport {
  campaign?: {
    id: string
    name: string
    channel: Channel
    status: CampaignStatus
    startedAt?: string | null
    completedAt?: string | null
    error?: string | null
    stats?: CampaignStats
  }
  totals?: Partial<Record<SendStatus, number>> & { total?: number }
  skippedByReason?: Record<string, number>
  failures?: ReportFailure[]
}

/* ---------- suppression (api/src/suppression) ---------- */

export interface SuppressionEntry {
  _id: string
  /** Normalised phone (E.164) or lowercased email. */
  value?: string
  channel?: Channel
  reason?: 'stop' | 'bounce' | 'complaint' | 'manual' | string
  evidence?: string
  createdAt?: string
}

/* ---------- inbox (no API endpoint yet; see inbox/page.tsx) ---------- */

export interface InboxMessage {
  _id: string
  contactId?: string
  contactName?: string
  from?: string
  phone?: string
  sender?: string
  body?: string
  message?: string
  receivedAt?: string
  createdAt?: string
  isStop?: boolean
  campaignId?: string
  campaignName?: string
}

/* ---------- gateway (api/src/gateway) ---------- */

export interface Device {
  _id: string
  enabled?: boolean
  brand?: string
  manufacturer?: string
  model?: string
  os?: string
  osVersion?: string
  appVersionName?: string
  sentSMSCount?: number
  receivedSMSCount?: number
  // Extended health fields the phone app may report. All optional.
  lastSeenAt?: string | null
  batteryLevel?: number | null
  isCharging?: boolean | null
  signal?: 'good' | 'fair' | 'poor' | 'none' | string | null
  simLabel?: string | null
  updatedAt?: string
}

export interface GatewayStats {
  totalSentSMSCount?: number
  totalReceivedSMSCount?: number
  totalDeviceCount?: number
  totalApiKeyCount?: number
  // Extended today-counters. All optional; the API does not report them yet.
  sentToday?: number
  deliveredToday?: number
  failedToday?: number
  newReplies?: number
  dailyCap?: number
}

/* ---------- settings (no API endpoint; local defaults only) ---------- */

/** Mirrors DEFAULT_PACING in api/src/sendline/sendline.enums.ts. */
export interface PacingSettings {
  ratePerMinute?: number
  dailyCap?: number
  windowStartHour?: number
  windowEndHour?: number
  jitterMs?: number
  timezone?: string
}

export interface Settings {
  pacing?: PacingSettings
  shopName?: string
}

/* ---------- auth (api/src/auth) ---------- */

export interface ApiKey {
  _id: string
  name?: string
  apiKey?: string // masked prefix e.g. "sl_live_ab12****"
  usageCount?: number
  lastUsedAt?: string | null
  revokedAt?: string | null
  createdAt?: string
}

export interface LoginResponse {
  accessToken: string
  user?: { _id?: string; name?: string; username?: string; email?: string }
}
