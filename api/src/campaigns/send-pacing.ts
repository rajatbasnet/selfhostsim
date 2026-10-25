import { DEFAULT_PACING } from '../sendline/sendline.enums'

/**
 * Pure pacing arithmetic. No timers, no Date.now(): every function takes the
 * current time as an argument so tests can pin it.
 *
 * Time zones are handled as an explicit UTC offset. A pacing timezone may be
 * written as an offset ('UTC', 'Z', '+05:45', 'UTC-4', 'GMT+01:00') or as an
 * IANA name ('Asia/Kathmandu'), in which case the offset at the instant in
 * question is read from the runtime's own Intl tables. Anything unparseable
 * falls back to UTC rather than throwing; a campaign must never crash on a
 * typo in a settings field.
 */

export interface PacingConfig {
  ratePerMinute: number
  dailyCap: number
  windowStartHour: number
  windowEndHour: number
  timezone?: string
  jitterMs?: number
}

export const MS_PER_MINUTE = 60_000
export const MS_PER_HOUR = 3_600_000
export const MS_PER_DAY = 86_400_000

const OFFSET_PATTERN = /^(?:UTC|GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function intlOffsetMinutes(timezone: string, at: Date): number | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts: Record<string, number> = {}
    for (const part of formatter.formatToParts(at)) {
      if (part.type !== 'literal') {
        parts[part.type] = Number(part.value)
      }
    }
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour === 24 ? 0 : parts.hour,
      parts.minute,
      parts.second,
    )
    // Drop sub-second noise so the comparison is on whole seconds.
    const atSeconds = at.getTime() - (at.getTime() % 1000)
    return Math.round((asUtc - atSeconds) / MS_PER_MINUTE)
  } catch {
    return null
  }
}

/**
 * Minutes east of UTC for `timezone` at instant `at`. Offsets are constant;
 * IANA zones may differ by instant because of DST. Unknown input -> 0.
 */
export function utcOffsetMinutes(
  timezone: string | null | undefined,
  at: Date = new Date(0),
): number {
  if (!timezone) {
    return 0
  }
  const value = String(timezone).trim()
  if (!value || /^(utc|gmt|z)$/i.test(value)) {
    return 0
  }
  const match = OFFSET_PATTERN.exec(value)
  if (match) {
    const sign = match[1] === '-' ? -1 : 1
    const hours = Number(match[2])
    const minutes = Number(match[3] ?? '0')
    if (hours > 14 || minutes > 59) {
      return 0
    }
    return sign * (hours * 60 + minutes)
  }
  return intlOffsetMinutes(value, at) ?? 0
}

/** Milliseconds since local midnight for `now` in `timezone`. */
export function localMsOfDay(now: Date, timezone?: string): number {
  const offset = utcOffsetMinutes(timezone, now)
  const shifted = now.getTime() + offset * MS_PER_MINUTE
  return ((shifted % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY
}

/** The UTC instant at which the local day containing `now` began. */
export function startOfLocalDay(now: Date, timezone?: string): Date {
  return new Date(now.getTime() - localMsOfDay(now, timezone))
}

function windowBounds(pacing: PacingConfig): {
  startMs: number
  endMs: number
  alwaysOpen: boolean
} {
  const start = isFiniteNumber(pacing?.windowStartHour)
    ? pacing.windowStartHour
    : DEFAULT_PACING.windowStartHour
  const end = isFiniteNumber(pacing?.windowEndHour)
    ? pacing.windowEndHour
    : DEFAULT_PACING.windowEndHour
  const clamp = (hour: number) => Math.min(24, Math.max(0, hour))
  const startMs = clamp(start) * MS_PER_HOUR
  const endMs = clamp(end) * MS_PER_HOUR
  // A zero-length window means "no window configured", never "never send".
  return { startMs, endMs, alwaysOpen: startMs === endMs }
}

/**
 * True when local time is within [windowStartHour, windowEndHour). The start
 * is inclusive (09:00:00.000 is inside) and the end exclusive (20:00:00.000
 * is outside). Overnight windows (22 -> 6) wrap past midnight.
 */
export function isInsideSendWindow(
  now: Date,
  pacing: PacingConfig,
  timezone?: string,
): boolean {
  const { startMs, endMs, alwaysOpen } = windowBounds(pacing)
  if (alwaysOpen) {
    return true
  }
  const local = localMsOfDay(now, timezone ?? pacing?.timezone)
  if (startMs < endMs) {
    return local >= startMs && local < endMs
  }
  return local >= startMs || local < endMs
}

/**
 * The next instant at which the window is open. Returns `now` itself when the
 * window is already open, so callers can always `delay = next - now`.
 */
export function nextWindowOpening(
  now: Date,
  pacing: PacingConfig,
  timezone?: string,
): Date {
  const tz = timezone ?? pacing?.timezone
  if (isInsideSendWindow(now, pacing, tz)) {
    return now
  }
  const { startMs } = windowBounds(pacing)
  const local = localMsOfDay(now, tz)
  const dayStart = now.getTime() - local
  let candidate = dayStart + startMs
  if (candidate <= now.getTime()) {
    candidate += MS_PER_DAY
  }
  // DST may shift the offset between now and the candidate; re-anchor once.
  const drift =
    (utcOffsetMinutes(tz, new Date(candidate)) - utcOffsetMinutes(tz, now)) *
    MS_PER_MINUTE
  candidate -= drift
  return new Date(candidate)
}

/** 60000 / ratePerMinute, falling back to the default for rate <= 0 or NaN. */
export function spacingMs(ratePerMinute: number): number {
  const rate =
    isFiniteNumber(ratePerMinute) && ratePerMinute > 0
      ? ratePerMinute
      : DEFAULT_PACING.ratePerMinute
  return MS_PER_MINUTE / rate
}

/**
 * Delay before the `indexInBatch`-th message is released: its slot at the
 * configured rate, plus a uniform +/- jitter so the phone is never a perfect
 * metronome. `random` is injectable for deterministic tests. Never negative.
 */
export function computeReleaseDelayMs(
  indexInBatch: number,
  ratePerMinute: number,
  jitterMs: number,
  random: () => number = Math.random,
): number {
  const index = isFiniteNumber(indexInBatch) ? Math.max(0, indexInBatch) : 0
  const jitter = isFiniteNumber(jitterMs) ? Math.abs(jitterMs) : 0
  const base = index * spacingMs(ratePerMinute)
  const roll = Number(random())
  const unit = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0.5
  const offset = (unit * 2 - 1) * jitter
  return Math.max(0, Math.round(base + offset))
}

/**
 * How many more marketing messages may go out today. A cap of 0, negative or
 * NaN means "no cap configured" and yields Infinity; a cap is only a cap when
 * it is a positive number.
 */
export function remainingDailyAllowance(
  sentToday: number,
  dailyCap: number,
): number {
  if (!isFiniteNumber(dailyCap) || dailyCap <= 0) {
    return Number.POSITIVE_INFINITY
  }
  const sent = isFiniteNumber(sentToday) ? Math.max(0, sentToday) : 0
  return Math.max(0, dailyCap - sent)
}

/** Hours per local day in which sending is allowed. */
export function windowHoursPerDay(pacing: PacingConfig): number {
  const { startMs, endMs, alwaysOpen } = windowBounds(pacing)
  if (alwaysOpen) {
    return 24
  }
  const span = startMs < endMs ? endMs - startMs : MS_PER_DAY - startMs + endMs
  return span / MS_PER_HOUR
}

/** Messages that fit in one local day given rate, window and cap. */
export function dailyThroughput(pacing: PacingConfig): number {
  const byRate = Math.floor(
    (windowHoursPerDay(pacing) * MS_PER_HOUR) / spacingMs(pacing.ratePerMinute),
  )
  const cap = remainingDailyAllowance(0, pacing.dailyCap)
  return Math.max(1, Math.min(byRate, cap))
}

/**
 * Rough wall-clock time to drain `count` messages, starting from an open
 * window with a fresh daily allowance. Preview only; the processor is the
 * authority at dispatch time.
 */
export function estimateSendDurationMs(
  count: number,
  pacing: PacingConfig,
): number {
  const total = isFiniteNumber(count) ? Math.max(0, Math.floor(count)) : 0
  if (total === 0) {
    return 0
  }
  const perDay = dailyThroughput(pacing)
  const fullDays = Math.floor((total - 1) / perDay)
  const onLastDay = total - fullDays * perDay
  return (
    fullDays * MS_PER_DAY + (onLastDay - 1) * spacingMs(pacing.ratePerMinute)
  )
}

/**
 * Delay from `now` until the `index`-th message of a freshly started campaign
 * should be released, honouring rate, jitter, the send window and the daily
 * cap. Messages past the cap roll to the next day's window. Best-effort: the
 * processor re-checks window and cap when the job actually runs.
 */
export function computeScheduledDelayMs(
  index: number,
  pacing: PacingConfig,
  now: Date,
  random: () => number = Math.random,
): number {
  const perDay = dailyThroughput(pacing)
  const safeIndex = isFiniteNumber(index) ? Math.max(0, Math.floor(index)) : 0
  const dayIndex = Math.floor(safeIndex / perDay)
  const indexInDay = safeIndex - dayIndex * perDay
  const jitter = isFiniteNumber(pacing.jitterMs)
    ? pacing.jitterMs
    : DEFAULT_PACING.jitterMs

  let anchor = nextWindowOpening(now, pacing).getTime()
  if (dayIndex > 0) {
    // Later days always start at the window opening, not at "now".
    const firstOpening = isInsideSendWindow(now, pacing)
      ? startOfLocalDay(now, pacing.timezone).getTime() +
        windowBounds(pacing).startMs
      : anchor
    anchor = nextWindowOpening(
      new Date(firstOpening + dayIndex * MS_PER_DAY),
      pacing,
    ).getTime()
  }

  let release =
    anchor +
    computeReleaseDelayMs(indexInDay, pacing.ratePerMinute, jitter, random)
  if (!isInsideSendWindow(new Date(release), pacing)) {
    release = nextWindowOpening(new Date(release), pacing).getTime()
  }
  return Math.max(0, release - now.getTime())
}
