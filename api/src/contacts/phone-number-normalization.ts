/**
 * Phone numbers arrive from CSV files, web forms and a point-of-sale, in every
 * shape a human can type. Everything downstream - dedupe, suppression lookup,
 * "have we already sent to this person" - compares numbers as strings, so they
 * must be normalised to one canonical form at the edge, exactly once.
 *
 * Canonical form is E.164: a leading '+' and up to 15 digits, nothing else.
 *
 * This deliberately refuses rather than guesses. A number it cannot normalise
 * confidently comes back as null and the row is held back, because a wrong
 * guess here sends a real message to a real stranger.
 */

const E164_MAX_DIGITS = 15
const E164_MIN_DIGITS = 8

/**
 * Strip everything a human might decorate a number with: spaces, dashes,
 * brackets, dots, and the non-breaking spaces that spreadsheets love.
 */
function stripFormatting(raw: string): string {
  return raw.replace(/[\s ().\-/\\]/g, '')
}

export interface NormalizeOptions {
  /**
   * Digits to prepend when a number is written in local form (a leading 0, or
   * no country code at all). Given without a '+', e.g. '977' or '1'.
   * When absent, a local-looking number is refused instead of guessed.
   */
  defaultCountryCode?: string
}

/**
 * Returns the number in E.164, or null when it cannot be normalised with
 * confidence. Never throws.
 */
export function normalizePhoneNumber(
  raw: string | null | undefined,
  options: NormalizeOptions = {},
): string | null {
  if (typeof raw !== 'string') return null

  let value = stripFormatting(raw.trim())
  if (!value) return null

  // '00' is the international prefix in most of the world; '+' is the same thing.
  if (value.startsWith('00')) {
    value = `+${value.slice(2)}`
  }

  const hasPlus = value.startsWith('+')
  const digits = hasPlus ? value.slice(1) : value

  // Anything that is not a digit at this point (letters, a second '+') is junk.
  if (!/^\d+$/.test(digits)) return null

  if (hasPlus) {
    return isPlausibleE164(digits) ? `+${digits}` : null
  }

  const countryCode = options.defaultCountryCode?.replace(/\D/g, '')
  if (!countryCode) {
    // No country code to apply and none given: refuse rather than invent one.
    return null
  }

  // A leading zero is a national trunk prefix and is dropped when the country
  // code goes on: 098... in Nepal is +97798...
  const national = digits.replace(/^0+/, '')
  if (!national) return null

  // Already carries the country code (someone typed it without the '+').
  if (digits.startsWith(countryCode) && isPlausibleE164(digits)) {
    return `+${digits}`
  }

  const combined = `${countryCode}${national}`
  return isPlausibleE164(combined) ? `+${combined}` : null
}

function isPlausibleE164(digits: string): boolean {
  if (digits.length < E164_MIN_DIGITS || digits.length > E164_MAX_DIGITS) {
    return false
  }
  // E.164 country codes never start with 0.
  return !digits.startsWith('0')
}

/** True when the value is already in canonical E.164 form. */
export function isNormalizedPhoneNumber(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value)
}

/**
 * Lowercased and trimmed. Email comparison is case-insensitive in practice for
 * every provider that matters, and a suppression list that misses
 * "Asha@Example.com" because it stored "asha@example.com" is worse than useless.
 */
export function normalizeEmailAddress(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  if (!value) return null
  // Deliberately permissive: one @, something either side, a dot in the domain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null
  return value
}
