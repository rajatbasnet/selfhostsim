import { OPT_OUT_KEYWORDS } from '../sendline/sendline.enums'

/**
 * Pure keyword matching for inbound SMS consent signals.
 *
 * Carrier and regulator conventions (CTIA, TCPA/FCC, GDPR ePrivacy guidance)
 * treat a message whose WHOLE body is a reserved keyword as an unambiguous
 * machine-readable instruction. This module implements exactly that and
 * nothing cleverer: a keyword must be the entire message, not a word inside it.
 *
 * Design decision on natural-language phrasings such as
 * "I want to stop receiving these" or "please don't text me":
 *
 *   These are NOT matched here and come back `false`.
 *
 *   Reasoning: a substring or "contains the word" matcher produces false
 *   positives that are just as harmful as misses. "Please don't stop the
 *   weekend deals", "stop by the shop tomorrow" and "nonstop" would all opt
 *   people out who asked for the opposite, and silently losing a willing
 *   subscriber is a real cost to the business. Conversely, a natural-language
 *   opt-out that this function does not recognise is NOT lost: the gateway
 *   routes every non-keyword reply to the inbox (`action: 'inbox'`), where a
 *   human reads it and can add a manual suppression. `containsOptOutKeyword`
 *   is exported so the inbox can flag such messages for priority review.
 *   The automated path therefore stays precise and the human path stays
 *   complete; that split is deliberate.
 *
 * Tolerances that ARE applied, because they do not change meaning:
 *   - case ("Stop", "STOP", "sToP")
 *   - surrounding whitespace, including non-breaking spaces
 *   - surrounding punctuation ("STOP!", "Stop.", "\"stop\"", "...stop...")
 *   - internal whitespace / hyphen variants of multi-part keywords
 *     ("opt out", "opt-out", "OPT  OUT", "stop all" all read as one keyword)
 *   - Unicode compatibility forms (full-width letters) via NFKC
 */

/** Keywords that re-grant consent. Whole-message match, same tolerances. */
export const OPT_IN_KEYWORDS = [
  'start',
  'unstop',
  'yes',
  'subscribe',
  'optin',
  'opt-in',
] as const

/**
 * Strips everything that is not a letter or digit. This is the "compact" form
 * used so that "opt-out", "opt out" and "optout" are the same keyword.
 */
function compact(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, '')
}

const OPT_OUT_COMPACT = new Set<string>(OPT_OUT_KEYWORDS.map(compact))
const OPT_IN_COMPACT = new Set<string>(OPT_IN_KEYWORDS.map(compact))

/**
 * Canonical form of an inbound body for matching: NFKC-folded, lower-cased,
 * trimmed, surrounding punctuation removed, internal whitespace collapsed to a
 * single space. Returns '' for anything that is not a non-empty string.
 */
export function normalizeMessageBody(body: unknown): string {
  if (typeof body !== 'string') return ''
  return body
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim()
}

function matchesWholeMessage(
  body: unknown,
  compactKeywords: Set<string>,
): boolean {
  const normalized = normalizeMessageBody(body)
  if (!normalized) return false
  return compactKeywords.has(compact(normalized))
}

/**
 * True when the entire message is an opt-out keyword from OPT_OUT_KEYWORDS.
 * Never matches a keyword embedded in a longer sentence.
 */
export function isOptOutMessage(body: string): boolean {
  return matchesWholeMessage(body, OPT_OUT_COMPACT)
}

/**
 * True when the entire message is an opt-in keyword (START / UNSTOP / YES ...).
 */
export function isOptInMessage(body: string): boolean {
  return matchesWholeMessage(body, OPT_IN_COMPACT)
}

/**
 * Soft signal for human review: true when any opt-out keyword appears as a
 * standalone word anywhere in the message. This must NEVER be used to
 * suppress automatically (see the design note above); it exists so the inbox
 * can surface "I want to stop receiving these" ahead of other replies.
 */
export function containsOptOutKeyword(body: string): boolean {
  const normalized = normalizeMessageBody(body)
  if (!normalized) return false
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  // Single words ("stop", "unsubscribe") and adjacent pairs ("opt out").
  for (let i = 0; i < words.length; i++) {
    if (OPT_OUT_COMPACT.has(words[i])) return true
    if (i + 1 < words.length && OPT_OUT_COMPACT.has(words[i] + words[i + 1])) {
      return true
    }
  }
  return false
}
