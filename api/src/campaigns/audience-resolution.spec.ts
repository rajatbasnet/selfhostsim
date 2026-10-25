import { Channel, SkipReason } from '../sendline/sendline.enums'
import {
  AudienceContact,
  hasConsentForChannel,
  recipientForChannel,
  resolveAudience,
  summarizeSkips,
} from './audience-resolution'

const contact = (
  overrides: Partial<AudienceContact> = {},
): AudienceContact => ({
  _id: overrides._id ?? Math.random().toString(36).slice(2),
  name: 'Test',
  phone: '+9779800000001',
  email: 'test@example.com',
  smsConsent: true,
  emailConsent: true,
  optedOutAt: null,
  ...overrides,
})

describe('recipientForChannel', () => {
  it('returns the E.164 phone for SMS', () => {
    expect(recipientForChannel(contact(), Channel.SMS)).toBe('+9779800000001')
  })

  it('lowercases and trims email', () => {
    expect(
      recipientForChannel(
        contact({ email: '  Foo@Example.COM ' }),
        Channel.EMAIL,
      ),
    ).toBe('foo@example.com')
  })

  it('returns null when the channel address is missing or blank', () => {
    expect(
      recipientForChannel(contact({ phone: undefined }), Channel.SMS),
    ).toBeNull()
    expect(
      recipientForChannel(contact({ phone: '   ' }), Channel.SMS),
    ).toBeNull()
    expect(
      recipientForChannel(contact({ email: null }), Channel.EMAIL),
    ).toBeNull()
  })

  it('refuses phones that are not E.164 and emails without an @', () => {
    expect(
      recipientForChannel(contact({ phone: '9800000001' }), Channel.SMS),
    ).toBeNull()
    expect(
      recipientForChannel(contact({ email: 'nope' }), Channel.EMAIL),
    ).toBeNull()
  })
})

describe('hasConsentForChannel', () => {
  it('is per channel', () => {
    const c = contact({ smsConsent: true, emailConsent: false })
    expect(hasConsentForChannel(c, Channel.SMS)).toBe(true)
    expect(hasConsentForChannel(c, Channel.EMAIL)).toBe(false)
  })

  it('an opt-out timestamp overrides consent flags', () => {
    const c = contact({ optedOutAt: new Date() })
    expect(hasConsentForChannel(c, Channel.SMS)).toBe(false)
    expect(hasConsentForChannel(c, Channel.EMAIL)).toBe(false)
  })

  it('missing flags mean no consent', () => {
    expect(hasConsentForChannel({}, Channel.SMS)).toBe(false)
  })
})

describe('resolveAudience', () => {
  it('passes a clean contact through', () => {
    const c = contact()
    const result = resolveAudience({ contacts: [c], channel: Channel.SMS })
    expect(result.eligible).toEqual([
      { contact: c, recipient: '+9779800000001' },
    ])
    expect(result.skipped).toEqual([])
  })

  it('skips a contact with email consent but no email address as INVALID_ADDRESS', () => {
    const c = contact({ email: undefined, emailConsent: true })
    const result = resolveAudience({ contacts: [c], channel: Channel.EMAIL })
    expect(result.eligible).toHaveLength(0)
    expect(result.skipped).toEqual([
      { contact: c, recipient: null, reason: SkipReason.INVALID_ADDRESS },
    ])
  })

  it('skips a contact without consent for the channel as NO_CONSENT', () => {
    const noSms = contact({ smsConsent: false })
    const optedOut = contact({
      phone: '+9779800000002',
      optedOutAt: new Date(),
    })
    const result = resolveAudience({
      contacts: [noSms, optedOut],
      channel: Channel.SMS,
    })
    expect(result.eligible).toHaveLength(0)
    expect(result.skipped.map((s) => s.reason)).toEqual([
      SkipReason.NO_CONSENT,
      SkipReason.NO_CONSENT,
    ])
  })

  it('skips a suppressed recipient', () => {
    const c = contact()
    const result = resolveAudience({
      contacts: [c],
      channel: Channel.SMS,
      suppressed: new Set(['+9779800000001']),
    })
    expect(result.eligible).toHaveLength(0)
    expect(result.skipped[0].reason).toBe(SkipReason.SUPPRESSED)
  })

  it('accepts the suppressed set as any iterable', () => {
    const result = resolveAudience({
      contacts: [contact()],
      channel: Channel.SMS,
      suppressed: ['+9779800000001'],
    })
    expect(result.skipped[0].reason).toBe(SkipReason.SUPPRESSED)
  })

  it('matches suppression on the normalised email, not the raw one', () => {
    const c = contact({ email: 'Foo@Example.com' })
    const result = resolveAudience({
      contacts: [c],
      channel: Channel.EMAIL,
      suppressed: new Set(['foo@example.com']),
    })
    expect(result.skipped[0].reason).toBe(SkipReason.SUPPRESSED)
  })

  it('keeps the first of two contacts sharing a number and skips the second as DUPLICATE', () => {
    const first = contact({ _id: 'a' })
    const second = contact({ _id: 'b' })
    const result = resolveAudience({
      contacts: [first, second],
      channel: Channel.SMS,
    })
    expect(result.eligible).toEqual([
      { contact: first, recipient: '+9779800000001' },
    ])
    expect(result.skipped).toEqual([
      {
        contact: second,
        recipient: '+9779800000001',
        reason: SkipReason.DUPLICATE,
      },
    ])
  })

  it('does not count a non-consenting twin as the duplicate', () => {
    // The first row has no consent; the second is the one we actually send to.
    const first = contact({ _id: 'a', smsConsent: false })
    const second = contact({ _id: 'b' })
    const result = resolveAudience({
      contacts: [first, second],
      channel: Channel.SMS,
    })
    expect(result.eligible.map((e) => e.contact._id)).toEqual(['b'])
    expect(result.skipped.map((s) => s.reason)).toEqual([SkipReason.NO_CONSENT])
  })

  it('skips a recipient this campaign already sent to as ALREADY_SENT', () => {
    const c = contact()
    const result = resolveAudience({
      contacts: [c],
      channel: Channel.SMS,
      alreadySentRecipients: new Set(['+9779800000001']),
    })
    expect(result.eligible).toHaveLength(0)
    expect(result.skipped[0].reason).toBe(SkipReason.ALREADY_SENT)
  })

  it('reports an already-sent number appearing twice as ALREADY_SENT then DUPLICATE', () => {
    const result = resolveAudience({
      contacts: [contact({ _id: 'a' }), contact({ _id: 'b' })],
      channel: Channel.SMS,
      alreadySentRecipients: ['+9779800000001'],
    })
    expect(result.skipped.map((s) => s.reason)).toEqual([
      SkipReason.ALREADY_SENT,
      SkipReason.DUPLICATE,
    ])
  })

  it('applies the rules in order: address, consent, suppression, duplicate, already-sent', () => {
    // Suppressed AND no consent -> NO_CONSENT wins.
    const noConsentSuppressed = contact({ _id: 'a', smsConsent: false })
    // Suppressed AND already sent -> SUPPRESSED wins.
    const suppressedAlreadySent = contact({ _id: 'b', phone: '+9779800000002' })
    const result = resolveAudience({
      contacts: [noConsentSuppressed, suppressedAlreadySent],
      channel: Channel.SMS,
      suppressed: ['+9779800000001', '+9779800000002'],
      alreadySentRecipients: ['+9779800000002'],
    })
    expect(result.skipped.map((s) => s.reason)).toEqual([
      SkipReason.NO_CONSENT,
      SkipReason.SUPPRESSED,
    ])
  })

  it('preserves input order and is deterministic', () => {
    const contacts = [
      contact({ _id: '1', phone: '+9779800000001' }),
      contact({ _id: '2', phone: '+9779800000002' }),
      contact({ _id: '3', phone: '+9779800000003' }),
    ]
    const a = resolveAudience({ contacts, channel: Channel.SMS })
    const b = resolveAudience({ contacts, channel: Channel.SMS })
    expect(a.eligible.map((e) => e.contact._id)).toEqual(['1', '2', '3'])
    expect(a).toEqual(b)
  })

  it('tolerates an empty or missing contact list', () => {
    expect(resolveAudience({ contacts: [], channel: Channel.SMS })).toEqual({
      eligible: [],
      skipped: [],
    })
    expect(
      resolveAudience({ contacts: undefined as any, channel: Channel.EMAIL }),
    ).toEqual({ eligible: [], skipped: [] })
  })

  it('resolves email campaigns on the email field only', () => {
    const phoneOnly = contact({ email: undefined })
    const result = resolveAudience({
      contacts: [phoneOnly],
      channel: Channel.EMAIL,
    })
    expect(result.skipped[0].reason).toBe(SkipReason.INVALID_ADDRESS)
  })
})

describe('summarizeSkips', () => {
  it('counts every reason, including zeroes', () => {
    const summary = summarizeSkips([
      { reason: SkipReason.DUPLICATE },
      { reason: SkipReason.DUPLICATE },
      { reason: SkipReason.SUPPRESSED },
    ])
    expect(summary).toEqual({
      [SkipReason.SUPPRESSED]: 1,
      [SkipReason.NO_CONSENT]: 0,
      [SkipReason.DUPLICATE]: 2,
      [SkipReason.INVALID_ADDRESS]: 0,
      [SkipReason.ALREADY_SENT]: 0,
    })
  })
})
