// Shapes the web console assumes the Sendline API returns.
// Every field that the API might not send yet is optional, and every
// screen renders a plain-language fallback when it is missing.

export type Channel = 'sms' | 'email' | 'both'

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

export interface Contact {
  _id: string
  name?: string
  firstName?: string
  lastName?: string
  phone?: string
  email?: string
  tags?: string[]
  attributes?: Record<string, string>
  smsConsent?: boolean
  emailConsent?: boolean
  consentSource?: string
  consentAt?: string
  optedOutAt?: string | null
  suppressed?: boolean
  lastMessageAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export type ContactFilter = 'all' | 'sms_ok' | 'email_ok' | 'opted_out' | 'no_consent'

export interface ContactList {
  _id: string
  name: string
  type?: 'static' | 'dynamic'
  filter?: Record<string, unknown>
  contactIds?: string[]
  memberCount?: number
  createdAt?: string
  updatedAt?: string
}

export interface Template {
  _id: string
  name: string
  channel: Channel
  subject?: string
  body: string
  segmentCount?: number
  createdAt?: string
  updatedAt?: string
}

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'paused'
  | 'done'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | string

export interface CampaignStats {
  picked?: number
  eligible?: number
  queued?: number
  sent?: number
  delivered?: number
  failed?: number
  optedOut?: number
  replied?: number
}

export interface SendWindow {
  start: string // "09:00"
  end: string // "20:00"
}

export interface Campaign {
  _id: string
  name: string
  channel: Channel
  templateId?: string
  listId?: string
  status: CampaignStatus
  sendWindow?: SendWindow
  timezone?: string
  ratePerMin?: number
  dailyCap?: number
  scheduledAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  stats?: CampaignStats
  createdAt?: string
  updatedAt?: string
}

export interface HeldBack {
  suppressed?: number
  noConsent?: number
  duplicates?: number
  invalid?: number
  alreadySent?: number
  [reason: string]: number | undefined
}

export interface PreviewSample {
  contact?: Partial<Contact>
  to?: string
  renderedSubject?: string
  renderedBody: string
  segmentCount?: number
  characterCount?: number
}

export interface CampaignPreview {
  audience?: {
    selected?: number
    eligible?: number
    heldBack?: HeldBack
  }
  samples?: PreviewSample[]
  nextNames?: string[]
  estimatedMinutes?: number
  segmentCount?: number
}

export interface Failure {
  sendId?: string
  contactId?: string
  name?: string
  phone?: string
  email?: string
  error?: string
  suggestion?: string
  failedAt?: string
}

export interface CampaignReport {
  campaign?: Campaign
  stats?: CampaignStats
  heldBack?: HeldBack
  failures?: Failure[]
}

export interface SuppressionEntry {
  _id: string
  phone?: string
  email?: string
  reason?: 'stop' | 'bounce' | 'complaint' | 'manual' | string
  createdAt?: string
}

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
  // Extended today-counters. All optional.
  sentToday?: number
  deliveredToday?: number
  failedToday?: number
  newReplies?: number
  dailyCap?: number
}

export interface PacingSettings {
  ratePerMin?: number
  dailyCap?: number
  windowStart?: string
  windowEnd?: string
  jitterSeconds?: number
  timezone?: string
}

export interface SmtpSettings {
  host?: string
  port?: number
  secure?: boolean
  user?: string
  password?: string
  fromName?: string
  fromEmail?: string
}

export interface Settings {
  pacing?: PacingSettings
  smtp?: SmtpSettings
  shopName?: string
}

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
