import { DEFAULT_PACING } from '../sendline/sendline.enums'
import {
  computeReleaseDelayMs,
  computeScheduledDelayMs,
  dailyThroughput,
  estimateSendDurationMs,
  isInsideSendWindow,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  nextWindowOpening,
  PacingConfig,
  remainingDailyAllowance,
  spacingMs,
  startOfLocalDay,
  utcOffsetMinutes,
  windowHoursPerDay,
} from './send-pacing'

const pacing = (overrides: Partial<PacingConfig> = {}): PacingConfig => ({
  ratePerMinute: 10,
  dailyCap: 500,
  windowStartHour: 9,
  windowEndHour: 20,
  timezone: 'UTC',
  jitterMs: 2000,
  ...overrides,
})

const utc = (iso: string) => new Date(iso)

describe('utcOffsetMinutes', () => {
  it('treats UTC, GMT, Z and empty as zero', () => {
    expect(utcOffsetMinutes('UTC')).toBe(0)
    expect(utcOffsetMinutes('gmt')).toBe(0)
    expect(utcOffsetMinutes('Z')).toBe(0)
    expect(utcOffsetMinutes('')).toBe(0)
    expect(utcOffsetMinutes(undefined)).toBe(0)
  })

  it('parses explicit offsets in several spellings', () => {
    expect(utcOffsetMinutes('+05:45')).toBe(345)
    expect(utcOffsetMinutes('+0545')).toBe(345)
    expect(utcOffsetMinutes('UTC+5:45')).toBe(345)
    expect(utcOffsetMinutes('GMT-04:00')).toBe(-240)
    expect(utcOffsetMinutes('-4')).toBe(-240)
  })

  it('resolves IANA names through Intl, including DST', () => {
    expect(
      utcOffsetMinutes('Asia/Kathmandu', utc('2026-01-15T00:00:00Z')),
    ).toBe(345)
    expect(
      utcOffsetMinutes('America/New_York', utc('2026-01-15T12:00:00Z')),
    ).toBe(-300)
    expect(
      utcOffsetMinutes('America/New_York', utc('2026-07-15T12:00:00Z')),
    ).toBe(-240)
  })

  it('falls back to UTC on garbage instead of throwing', () => {
    expect(utcOffsetMinutes('Mars/Olympus_Mons')).toBe(0)
    expect(utcOffsetMinutes('+99:00')).toBe(0)
  })
})

describe('startOfLocalDay', () => {
  it('returns local midnight as a UTC instant', () => {
    expect(startOfLocalDay(utc('2026-03-10T15:30:00Z'), 'UTC')).toEqual(
      utc('2026-03-10T00:00:00Z'),
    )
    // 15:30Z is 21:15 in Kathmandu; local midnight was 18:15Z the day before.
    expect(startOfLocalDay(utc('2026-03-10T15:30:00Z'), '+05:45')).toEqual(
      utc('2026-03-09T18:15:00Z'),
    )
  })
})

describe('isInsideSendWindow', () => {
  const p = pacing()

  it('is inclusive at exactly 09:00:00', () => {
    expect(isInsideSendWindow(utc('2026-03-10T09:00:00.000Z'), p, 'UTC')).toBe(
      true,
    )
  })

  it('is closed one millisecond before 09:00:00', () => {
    expect(isInsideSendWindow(utc('2026-03-10T08:59:59.999Z'), p, 'UTC')).toBe(
      false,
    )
  })

  it('is exclusive at exactly 20:00:00', () => {
    expect(isInsideSendWindow(utc('2026-03-10T20:00:00.000Z'), p, 'UTC')).toBe(
      false,
    )
  })

  it('is open one millisecond before 20:00:00', () => {
    expect(isInsideSendWindow(utc('2026-03-10T19:59:59.999Z'), p, 'UTC')).toBe(
      true,
    )
  })

  it('evaluates in the given timezone, not UTC', () => {
    // 03:15Z is 09:00 in Kathmandu.
    expect(isInsideSendWindow(utc('2026-03-10T03:15:00Z'), p, '+05:45')).toBe(
      true,
    )
    expect(isInsideSendWindow(utc('2026-03-10T03:14:59Z'), p, '+05:45')).toBe(
      false,
    )
    // 14:15Z is 20:00 in Kathmandu -> closed.
    expect(isInsideSendWindow(utc('2026-03-10T14:15:00Z'), p, '+05:45')).toBe(
      false,
    )
  })

  it('falls back to pacing.timezone when no explicit timezone is given', () => {
    const np = pacing({ timezone: 'Asia/Kathmandu' })
    expect(isInsideSendWindow(utc('2026-03-10T03:15:00Z'), np)).toBe(true)
    expect(isInsideSendWindow(utc('2026-03-10T03:14:59Z'), np)).toBe(false)
  })

  it('handles an overnight window that wraps midnight', () => {
    const night = pacing({ windowStartHour: 22, windowEndHour: 6 })
    expect(isInsideSendWindow(utc('2026-03-10T23:00:00Z'), night, 'UTC')).toBe(
      true,
    )
    expect(isInsideSendWindow(utc('2026-03-10T03:00:00Z'), night, 'UTC')).toBe(
      true,
    )
    expect(isInsideSendWindow(utc('2026-03-10T06:00:00Z'), night, 'UTC')).toBe(
      false,
    )
    expect(isInsideSendWindow(utc('2026-03-10T12:00:00Z'), night, 'UTC')).toBe(
      false,
    )
  })

  it('treats start == end as always open', () => {
    const all = pacing({ windowStartHour: 0, windowEndHour: 0 })
    expect(isInsideSendWindow(utc('2026-03-10T03:00:00Z'), all, 'UTC')).toBe(
      true,
    )
  })
})

describe('nextWindowOpening', () => {
  const p = pacing()

  it('returns now when the window is open', () => {
    const now = utc('2026-03-10T12:00:00Z')
    expect(nextWindowOpening(now, p)).toBe(now)
  })

  it('returns today 09:00 when it is before the window', () => {
    expect(nextWindowOpening(utc('2026-03-10T05:00:00Z'), p)).toEqual(
      utc('2026-03-10T09:00:00Z'),
    )
  })

  it('returns tomorrow 09:00 when it is after the window', () => {
    expect(nextWindowOpening(utc('2026-03-10T20:00:00Z'), p)).toEqual(
      utc('2026-03-11T09:00:00Z'),
    )
    expect(nextWindowOpening(utc('2026-03-10T23:59:59Z'), p)).toEqual(
      utc('2026-03-11T09:00:00Z'),
    )
  })

  it('honours the timezone offset', () => {
    // 20:00 Kathmandu = 14:15Z. Next opening: 09:00 Kathmandu next day = 03:15Z.
    expect(nextWindowOpening(utc('2026-03-10T14:15:00Z'), p, '+05:45')).toEqual(
      utc('2026-03-11T03:15:00Z'),
    )
  })

  it('accounts for a DST change between now and the opening', () => {
    // New York springs forward on 2026-03-08 at 02:00 local.
    const ny = pacing({ timezone: 'America/New_York' })
    // 2026-03-07 21:00 local (EST, -5) = 02:00Z on the 8th.
    const now = utc('2026-03-08T02:00:00Z')
    // Next opening is 09:00 local on the 8th, which is EDT (-4) = 13:00Z.
    expect(nextWindowOpening(now, ny)).toEqual(utc('2026-03-08T13:00:00Z'))
  })
})

describe('spacingMs', () => {
  it('is 60000 / rate', () => {
    expect(spacingMs(10)).toBe(6000)
    expect(spacingMs(60)).toBe(1000)
  })

  it('does not divide by zero and falls back to the default for rate <= 0', () => {
    const fallback = MS_PER_MINUTE / DEFAULT_PACING.ratePerMinute
    expect(spacingMs(0)).toBe(fallback)
    expect(spacingMs(-5)).toBe(fallback)
    expect(spacingMs(NaN)).toBe(fallback)
    expect(spacingMs(Infinity)).toBe(fallback)
    expect(Number.isFinite(spacingMs(0))).toBe(true)
  })
})

describe('computeReleaseDelayMs', () => {
  it('spaces messages at 60000 / rate with no jitter', () => {
    expect(computeReleaseDelayMs(0, 10, 0)).toBe(0)
    expect(computeReleaseDelayMs(1, 10, 0)).toBe(6000)
    expect(computeReleaseDelayMs(5, 10, 0)).toBe(30000)
    expect(computeReleaseDelayMs(1, 60, 0)).toBe(1000)
  })

  it('applies +/- jitter deterministically through the injected random', () => {
    expect(computeReleaseDelayMs(1, 10, 2000, () => 1)).toBe(8000)
    expect(computeReleaseDelayMs(1, 10, 2000, () => 0)).toBe(4000)
    expect(computeReleaseDelayMs(1, 10, 2000, () => 0.5)).toBe(6000)
  })

  it('never returns a negative delay, even for the first message with max negative jitter', () => {
    expect(computeReleaseDelayMs(0, 10, 2000, () => 0)).toBe(0)
    expect(computeReleaseDelayMs(0, 10, 999999, () => 0)).toBe(0)
    for (let i = 0; i < 200; i++) {
      expect(computeReleaseDelayMs(i % 3, 10, 50000)).toBeGreaterThanOrEqual(0)
    }
  })

  it('does not hang or divide by zero for rate 0 or negative', () => {
    const fallback = MS_PER_MINUTE / DEFAULT_PACING.ratePerMinute
    expect(computeReleaseDelayMs(1, 0, 0)).toBe(fallback)
    expect(computeReleaseDelayMs(2, -10, 0)).toBe(2 * fallback)
    expect(Number.isFinite(computeReleaseDelayMs(1, 0, 0))).toBe(true)
  })

  it('tolerates nonsense index, jitter and random values', () => {
    expect(computeReleaseDelayMs(-3, 10, 0)).toBe(0)
    expect(computeReleaseDelayMs(NaN, 10, 0)).toBe(0)
    expect(computeReleaseDelayMs(1, 10, -2000, () => 1)).toBe(8000)
    expect(computeReleaseDelayMs(1, 10, NaN)).toBe(6000)
    expect(computeReleaseDelayMs(1, 10, 2000, () => NaN)).toBe(6000)
    expect(computeReleaseDelayMs(1, 10, 2000, () => 7)).toBe(8000)
  })

  it('returns an integer number of milliseconds', () => {
    expect(
      Number.isInteger(computeReleaseDelayMs(1, 7, 333, () => 0.123)),
    ).toBe(true)
  })
})

describe('remainingDailyAllowance', () => {
  it('subtracts what was sent', () => {
    expect(remainingDailyAllowance(0, 500)).toBe(500)
    expect(remainingDailyAllowance(120, 500)).toBe(380)
  })

  it('is zero when the cap is exhausted, never negative', () => {
    expect(remainingDailyAllowance(500, 500)).toBe(0)
    expect(remainingDailyAllowance(900, 500)).toBe(0)
  })

  it('treats a cap of 0, negative or NaN as no cap', () => {
    expect(remainingDailyAllowance(10, 0)).toBe(Number.POSITIVE_INFINITY)
    expect(remainingDailyAllowance(10, -1)).toBe(Number.POSITIVE_INFINITY)
    expect(remainingDailyAllowance(10, NaN)).toBe(Number.POSITIVE_INFINITY)
  })

  it('ignores a negative or NaN sentToday', () => {
    expect(remainingDailyAllowance(-5, 100)).toBe(100)
    expect(remainingDailyAllowance(NaN, 100)).toBe(100)
  })
})

describe('windowHoursPerDay and dailyThroughput', () => {
  it('computes window length including overnight windows', () => {
    expect(windowHoursPerDay(pacing())).toBe(11)
    expect(
      windowHoursPerDay(pacing({ windowStartHour: 22, windowEndHour: 6 })),
    ).toBe(8)
    expect(
      windowHoursPerDay(pacing({ windowStartHour: 0, windowEndHour: 0 })),
    ).toBe(24)
  })

  it('is the smaller of the cap and what the rate fits in the window', () => {
    // 10/min * 60 * 11h = 6600 > cap 500
    expect(dailyThroughput(pacing())).toBe(500)
    // 1/min * 60 * 2h = 120 < cap 500
    expect(
      dailyThroughput(
        pacing({ ratePerMinute: 1, windowStartHour: 9, windowEndHour: 11 }),
      ),
    ).toBe(120)
    expect(dailyThroughput(pacing({ dailyCap: 0, ratePerMinute: 1 }))).toBe(660)
  })

  it('is at least one even with absurd settings', () => {
    expect(
      dailyThroughput(pacing({ ratePerMinute: 0.0001, dailyCap: 1 })),
    ).toBe(1)
  })
})

describe('estimateSendDurationMs', () => {
  it('is zero for nothing to send', () => {
    expect(estimateSendDurationMs(0, pacing())).toBe(0)
    expect(estimateSendDurationMs(-4, pacing())).toBe(0)
  })

  it('is (n - 1) slots when everything fits in one day', () => {
    expect(estimateSendDurationMs(1, pacing())).toBe(0)
    expect(estimateSendDurationMs(11, pacing())).toBe(60_000)
  })

  it('adds whole days when the cap is exceeded', () => {
    // 500/day; 501 messages -> 1 full day, then the 1st message of day 2.
    expect(estimateSendDurationMs(501, pacing())).toBe(MS_PER_DAY)
    expect(estimateSendDurationMs(1000, pacing())).toBe(MS_PER_DAY + 499 * 6000)
  })

  it('does not blow up on rate 0', () => {
    expect(
      Number.isFinite(
        estimateSendDurationMs(100, pacing({ ratePerMinute: 0 })),
      ),
    ).toBe(true)
  })
})

describe('computeScheduledDelayMs', () => {
  const noJitter = () => 0.5

  it('releases from now when the window is open', () => {
    const now = utc('2026-03-10T12:00:00Z')
    expect(computeScheduledDelayMs(0, pacing(), now, noJitter)).toBe(0)
    expect(computeScheduledDelayMs(3, pacing(), now, noJitter)).toBe(18000)
  })

  it('waits for the window to open when it is closed', () => {
    const now = utc('2026-03-10T05:00:00Z')
    expect(computeScheduledDelayMs(0, pacing(), now, noJitter)).toBe(
      4 * MS_PER_HOUR,
    )
    expect(computeScheduledDelayMs(1, pacing(), now, noJitter)).toBe(
      4 * MS_PER_HOUR + 6000,
    )
  })

  it('rolls messages past the daily cap to the next day opening', () => {
    const now = utc('2026-03-10T12:00:00Z')
    const p = pacing({ dailyCap: 2 })
    expect(computeScheduledDelayMs(1, p, now, noJitter)).toBe(6000)
    // Index 2 is the first of day 2: 09:00 next day.
    expect(computeScheduledDelayMs(2, p, now, noJitter)).toBe(21 * MS_PER_HOUR)
    expect(computeScheduledDelayMs(3, p, now, noJitter)).toBe(
      21 * MS_PER_HOUR + 6000,
    )
  })

  it('pushes a release that would fall after the window end to the next opening', () => {
    // 19:59:57, 10/min -> index 1 lands at 20:00:03 -> rolled to 09:00 tomorrow.
    const now = utc('2026-03-10T19:59:57Z')
    const delay = computeScheduledDelayMs(1, pacing(), now, noJitter)
    expect(new Date(now.getTime() + delay)).toEqual(utc('2026-03-11T09:00:00Z'))
  })

  it('is never negative and finite for degenerate pacing', () => {
    const now = utc('2026-03-10T12:00:00Z')
    const bad = pacing({ ratePerMinute: 0, dailyCap: -1, jitterMs: 999999 })
    for (let i = 0; i < 20; i++) {
      const d = computeScheduledDelayMs(i, bad, now, () => 0)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(d)).toBe(true)
    }
  })
})
