// Plain-language formatting. Every number carries the word that explains it.

export function fmtNum(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat().format(n)
}

export function plural(n: number, one: string, many?: string): string {
  return `${fmtNum(n)} ${n === 1 ? one : many ?? one + 's'}`
}

/** "about 44 minutes", "about 2 hours", "under a minute". */
export function aboutMinutes(mins: number | undefined | null): string {
  if (mins === undefined || mins === null || Number.isNaN(mins)) return 'unknown time'
  if (mins < 1) return 'under a minute'
  if (mins < 60) return `about ${Math.round(mins)} ${Math.round(mins) === 1 ? 'minute' : 'minutes'}`
  const h = mins / 60
  if (h < 24) {
    const r = Math.round(h * 2) / 2
    return `about ${r} ${r === 1 ? 'hour' : 'hours'}`
  }
  const d = Math.round(h / 24)
  return `about ${d} ${d === 1 ? 'day' : 'days'}`
}

/** "4 seconds ago", "3 days ago", "yesterday", "never". */
export function timeAgo(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'never'
  const s = Math.max(0, Math.round((nowMs - t) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} seconds ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 14) return `${d} days ago`
  const w = Math.round(d / 7)
  if (w < 9) return `${w} weeks ago`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo} months ago`
  return new Date(iso).toLocaleDateString()
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "+977 98… 4412" – readable but not shouting the whole number. */
export function maskPhone(phone: string | undefined | null): string {
  if (!phone) return '—'
  const digits = phone.replace(/[^\d+]/g, '')
  if (digits.length <= 7) return phone
  const last4 = digits.slice(-4)
  const head = digits.slice(0, Math.min(6, digits.length - 4))
  // Split a leading +CC from the next two digits for readability.
  const m = head.match(/^(\+\d{1,3})(\d*)$/)
  const shown = m ? `${m[1]} ${m[2]}` : head
  return `${shown.trim()}… ${last4}`
}

export function maskEmail(email: string | undefined | null): string {
  if (!email) return '—'
  const [u, d] = email.split('@')
  if (!d) return email
  return `${u.slice(0, 5)}${u.length > 5 ? '…' : ''}@${d.length > 12 ? d.slice(0, 10) + '…' : d}`
}

export function titleCase(s: string): string {
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
}

export function displayName(c: { name?: string; firstName?: string; lastName?: string; phone?: string; email?: string } | undefined | null): string {
  if (!c) return 'Someone'
  if (c.name && c.name.trim()) return c.name.trim()
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
  if (full) return full
  return c.phone || c.email || 'Someone'
}

export function firstName(c: { name?: string; firstName?: string } | undefined | null): string {
  if (!c) return ''
  if (c.firstName) return c.firstName
  if (c.name) return c.name.trim().split(/\s+/)[0] ?? ''
  return ''
}

export function lastName(c: { name?: string; lastName?: string } | undefined | null): string {
  if (!c) return ''
  if (c.lastName) return c.lastName
  if (c.name) {
    const parts = c.name.trim().split(/\s+/)
    return parts.length > 1 ? parts.slice(1).join(' ') : ''
  }
  return ''
}

export function channelLabel(ch: string | undefined): string {
  if (ch === 'sms') return 'SMS'
  if (ch === 'email') return 'Email'
  return ch ? titleCase(ch) : '—'
}

/** POST /campaigns/:id/cancel leaves status "failed" with this error. */
export function isCancelled(c: { status?: string; error?: string | null } | null | undefined): boolean {
  return c?.status === 'failed' && /cancel/i.test(c.error ?? '')
}

/** CampaignStatus is draft | scheduled | sending | paused | completed | failed. */
export function statusLabel(status: string | undefined, error?: string | null): string {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'scheduled':
      return 'Scheduled'
    case 'sending':
      return 'Sending'
    case 'paused':
      return 'Paused'
    case 'completed':
      return 'Done'
    case 'failed':
      return isCancelled({ status, error }) ? 'Cancelled' : 'Stopped with errors'
    default:
      return status ? titleCase(status) : 'Unknown'
  }
}

export function isFinished(status: string | undefined): boolean {
  return status === 'completed'
}

export function isActive(status: string | undefined): boolean {
  return status === 'sending' || status === 'paused'
}

/** The API's SkipReason values, in plain language. Shared by the composer and the report. */
export const SKIP_REASONS: Record<string, { label: string; one: string; many: string; why: string }> = {
  suppressed: { label: 'opted out', one: 'was suppressed', many: 'were suppressed', why: 'replied STOP at some point' },
  no_consent: { label: 'no consent', one: 'had no consent', many: 'had no consent', why: 'imported without a source' },
  duplicate: { label: 'duplicates', one: 'was a duplicate', many: 'were duplicates', why: 'same number, two rows' },
  invalid_address: { label: 'numbers invalid', one: 'number was invalid or missing', many: 'numbers were invalid or missing', why: 'no usable phone number or email' },
  already_sent: { label: 'already got it', one: 'already had it', many: 'already had it', why: 'sent earlier in this campaign' },
}

/** 9 → "09:00", 24 → "24:00" (midnight, end of day). */
export function hourLabel(h: number | undefined | null): string {
  if (h === undefined || h === null || Number.isNaN(h)) return '—'
  return `${String(Math.max(0, Math.min(24, Math.round(h)))).padStart(2, '0')}:00`
}

/* --- clock arithmetic across zones ------------------------------------- */

function partsIn(zone: string, ms: number): Record<string, string> {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const o: Record<string, string> = {}
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== 'literal') o[part.type] = part.value
  return o
}

/** How far `zone` is from UTC at that instant, in ms. Positive is east. */
function offsetMs(zone: string, ms: number): number {
  const p = partsIn(zone, ms)
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms
}

/** The instant at which the clock in `zone` reads hour:00 on `ref`'s day there. */
function instantOfHour(zone: string, hour: number, ref: Date): number {
  const d = partsIn(zone, ref.getTime())
  const naive = Date.UTC(+d.year, +d.month - 1, +d.day, hour, 0, 0)
  // Two passes: the first offset is read at the wrong instant, which only
  // matters within an hour of a DST boundary, and the second settles it.
  return naive - offsetMs(zone, naive - offsetMs(zone, naive))
}

/**
 * "09:00 in `from`" read off a clock in `to`. dayShift says which side of
 * midnight it lands on, so a window that wraps can admit it rather than
 * showing a time that looks earlier than the one before it.
 */
export function hourAcrossZones(
  hour: number, from: string, to: string, ref: Date = new Date(),
): { time: string; dayShift: number } {
  try {
    const ms = instantOfHour(from, hour, ref)
    const a = partsIn(from, ms)
    const b = partsIn(to, ms)
    const dayA = Date.UTC(+a.year, +a.month - 1, +a.day)
    const dayB = Date.UTC(+b.year, +b.month - 1, +b.day)
    return {
      time: `${String(+b.hour % 24).padStart(2, '0')}:${b.minute}`,
      dayShift: Math.round((dayB - dayA) / 86400000),
    }
  } catch {
    // An unknown IANA name from the server should not blank the page.
    return { time: '—', dayShift: 0 }
  }
}

/** "CDT", "GMT+5:45". Computed, not hardcoded, because half of these shift twice a year. */
export function zoneAbbrev(zone: string, ref: Date = new Date()): string {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
    return f.formatToParts(ref).find((x) => x.type === 'timeZoneName')?.value ?? zone
  } catch {
    return zone
  }
}

/** A campaign's template/list/device may come back as an id or a populated document. */
export function idOf(v: string | { _id: string } | null | undefined): string {
  if (!v) return ''
  return typeof v === 'string' ? v : v._id ?? ''
}
