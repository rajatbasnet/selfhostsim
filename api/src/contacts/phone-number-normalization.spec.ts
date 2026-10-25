import {
  isNormalizedPhoneNumber,
  normalizeEmailAddress,
  normalizePhoneNumber,
} from './phone-number-normalization'

describe('phone-number-normalization', () => {
  describe('normalizePhoneNumber', () => {
    describe('international form', () => {
      it('passes through a clean E.164 number', () => {
        expect(normalizePhoneNumber('+9779801234567')).toBe('+9779801234567')
      })

      it('strips spaces, dashes, dots, brackets and slashes', () => {
        expect(normalizePhoneNumber('+977 980-123.4567')).toBe('+9779801234567')
        expect(normalizePhoneNumber('+1 (415) 555-2671')).toBe('+14155552671')
        expect(normalizePhoneNumber('+44 20/7946 0958')).toBe('+442079460958')
      })

      it('strips non-breaking spaces that spreadsheets insert', () => {
        expect(normalizePhoneNumber('+977 980 1234567')).toBe('+9779801234567')
      })

      it('treats the 00 international prefix as a plus', () => {
        expect(normalizePhoneNumber('009779801234567')).toBe('+9779801234567')
      })

      it('does not need a defaultCountryCode', () => {
        expect(normalizePhoneNumber('+9779801234567', {})).toBe(
          '+9779801234567',
        )
      })
    })

    describe('local form without a defaultCountryCode', () => {
      it('refuses a number with a leading zero', () => {
        expect(normalizePhoneNumber('09801234567')).toBeNull()
      })

      it('refuses a bare national number', () => {
        expect(normalizePhoneNumber('9801234567')).toBeNull()
      })

      it('refuses a number that already carries the country code but no plus', () => {
        // Without a country code hint we cannot tell 977... from a long local number.
        expect(normalizePhoneNumber('9779801234567')).toBeNull()
      })
    })

    describe('local form with a defaultCountryCode', () => {
      it('drops the trunk zero and prepends the country code', () => {
        expect(
          normalizePhoneNumber('09801234567', { defaultCountryCode: '977' }),
        ).toBe('+9779801234567')
      })

      it('prepends the country code to a bare national number', () => {
        expect(
          normalizePhoneNumber('9801234567', { defaultCountryCode: '977' }),
        ).toBe('+9779801234567')
      })

      it('recognises a number that already carries the country code', () => {
        expect(
          normalizePhoneNumber('9779801234567', { defaultCountryCode: '977' }),
        ).toBe('+9779801234567')
      })

      it('accepts the country code written with a plus or spaces', () => {
        expect(
          normalizePhoneNumber('9801234567', { defaultCountryCode: '+977' }),
        ).toBe('+9779801234567')
        expect(
          normalizePhoneNumber('9801234567', { defaultCountryCode: ' 977 ' }),
        ).toBe('+9779801234567')
      })

      it('handles a formatted US local number', () => {
        expect(
          normalizePhoneNumber('(415) 555-2671', { defaultCountryCode: '1' }),
        ).toBe('+14155552671')
      })

      it('treats an empty defaultCountryCode as absent', () => {
        expect(
          normalizePhoneNumber('9801234567', { defaultCountryCode: '' }),
        ).toBeNull()
      })

      it('returns null when the number is only zeros', () => {
        expect(
          normalizePhoneNumber('0000', { defaultCountryCode: '977' }),
        ).toBeNull()
      })
    })

    describe('junk', () => {
      it('returns null for empty, whitespace and non-string input', () => {
        expect(normalizePhoneNumber('')).toBeNull()
        expect(normalizePhoneNumber('   ')).toBeNull()
        expect(normalizePhoneNumber(null)).toBeNull()
        expect(normalizePhoneNumber(undefined)).toBeNull()
        expect(normalizePhoneNumber(12345 as unknown as string)).toBeNull()
      })

      it('returns null when letters are mixed in', () => {
        expect(normalizePhoneNumber('+977 98O1234567')).toBeNull()
        expect(normalizePhoneNumber('call me')).toBeNull()
        expect(
          normalizePhoneNumber('N/A', { defaultCountryCode: '977' }),
        ).toBeNull()
      })

      it('returns null for a second plus or a plus in the middle', () => {
        expect(normalizePhoneNumber('++9779801234567')).toBeNull()
        expect(normalizePhoneNumber('977+9801234567')).toBeNull()
      })

      it('returns null for an extension suffix', () => {
        expect(normalizePhoneNumber('+14155552671 ext 12')).toBeNull()
        expect(normalizePhoneNumber('+14155552671x12')).toBeNull()
      })

      it('returns null when too short or too long for E.164', () => {
        expect(normalizePhoneNumber('+1234567')).toBeNull()
        expect(normalizePhoneNumber('+1234567890123456')).toBeNull()
        expect(
          normalizePhoneNumber('12345', { defaultCountryCode: '1' }),
        ).toBeNull()
      })

      it('returns null for a plus followed by a leading zero', () => {
        expect(normalizePhoneNumber('+09801234567')).toBeNull()
      })

      it('returns null for a lone plus', () => {
        expect(normalizePhoneNumber('+')).toBeNull()
      })
    })
  })

  describe('isNormalizedPhoneNumber', () => {
    it('accepts canonical E.164', () => {
      expect(isNormalizedPhoneNumber('+9779801234567')).toBe(true)
      expect(isNormalizedPhoneNumber('+12345678')).toBe(true)
      expect(isNormalizedPhoneNumber('+123456789012345')).toBe(true)
    })

    it('rejects anything else', () => {
      expect(isNormalizedPhoneNumber('9779801234567')).toBe(false)
      expect(isNormalizedPhoneNumber('+0779801234567')).toBe(false)
      expect(isNormalizedPhoneNumber('+977 9801234567')).toBe(false)
      expect(isNormalizedPhoneNumber('+1234567')).toBe(false)
      expect(isNormalizedPhoneNumber('+1234567890123456')).toBe(false)
      expect(isNormalizedPhoneNumber('')).toBe(false)
    })

    it('agrees with normalizePhoneNumber on its own output', () => {
      const out = normalizePhoneNumber('0980-123-4567', {
        defaultCountryCode: '977',
      })
      expect(out).not.toBeNull()
      expect(isNormalizedPhoneNumber(out as string)).toBe(true)
    })
  })

  describe('normalizeEmailAddress', () => {
    it('lowercases and trims', () => {
      expect(normalizeEmailAddress('  Asha@Example.COM ')).toBe(
        'asha@example.com',
      )
    })

    it('accepts plus addressing and subdomains', () => {
      expect(normalizeEmailAddress('a+tag@mail.example.co.uk')).toBe(
        'a+tag@mail.example.co.uk',
      )
    })

    it('rejects values without an @, with two @s, with spaces or without a dotted domain', () => {
      expect(normalizeEmailAddress('asha.example.com')).toBeNull()
      expect(normalizeEmailAddress('a@b@example.com')).toBeNull()
      expect(normalizeEmailAddress('asha @example.com')).toBeNull()
      expect(normalizeEmailAddress('asha@localhost')).toBeNull()
      expect(normalizeEmailAddress('@example.com')).toBeNull()
      expect(normalizeEmailAddress('asha@')).toBeNull()
    })

    it('returns null for empty and non-string input', () => {
      expect(normalizeEmailAddress('')).toBeNull()
      expect(normalizeEmailAddress('   ')).toBeNull()
      expect(normalizeEmailAddress(null)).toBeNull()
      expect(normalizeEmailAddress(undefined)).toBeNull()
    })
  })
})
