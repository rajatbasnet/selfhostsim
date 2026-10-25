/**
 * SMS segment counting.
 *
 * A message that fits the GSM 03.38 alphabet is sent as GSM-7: 160 characters
 * in a single segment, or 153 per segment once concatenation headers are
 * needed. One character outside that alphabet (an emoji, Devanagari, a smart
 * quote) flips the whole message to UCS-2: 70 single / 67 per segment, counted
 * in UTF-16 code units, so an emoji made of a surrogate pair costs two.
 *
 * GSM 03.38 extension characters (^ { } \ [ ] ~ | and the euro sign) are
 * escaped on the wire and therefore cost two GSM-7 characters each.
 */

export type SmsEncoding = 'GSM-7' | 'UCS-2'

export interface SmsSegmentCount {
  encoding: SmsEncoding
  /** GSM-7: septets including escapes. UCS-2: UTF-16 code units. */
  characters: number
  /** 0 for an empty message. */
  segments: number
}

export const GSM7_SINGLE_SEGMENT_LIMIT = 160
export const GSM7_MULTIPART_SEGMENT_LIMIT = 153
export const UCS2_SINGLE_SEGMENT_LIMIT = 70
export const UCS2_MULTIPART_SEGMENT_LIMIT = 67

/** GSM 03.38 basic character set (ESC itself is not a user character). */
const GSM7_BASIC_CHARACTERS =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ' +
  ' !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§' +
  '¿abcdefghijklmnopqrstuvwxyzäöñüà'

/** GSM 03.38 extension table. Each costs ESC + char on the wire. */
const GSM7_EXTENSION_CHARACTERS = '\f^{}\\[~]|€'

const GSM7_BASIC = new Set(Array.from(GSM7_BASIC_CHARACTERS))
const GSM7_EXTENSION = new Set(Array.from(GSM7_EXTENSION_CHARACTERS))

/** True when every character of `text` is representable in GSM 03.38. */
export function isGsm7(text: string): boolean {
  for (const character of String(text ?? '')) {
    if (!GSM7_BASIC.has(character) && !GSM7_EXTENSION.has(character)) {
      return false
    }
  }
  return true
}

/**
 * Counts GSM-7 septets for a text already known to be GSM-7 encodable.
 * Returns -1 as soon as a non-GSM character is met.
 */
function countGsm7Septets(text: string): number {
  let septets = 0
  for (const character of text) {
    if (GSM7_BASIC.has(character)) {
      septets += 1
    } else if (GSM7_EXTENSION.has(character)) {
      septets += 2
    } else {
      return -1
    }
  }
  return septets
}

function segmentsFor(characters: number, single: number, multipart: number) {
  if (characters === 0) return 0
  if (characters <= single) return 1
  return Math.ceil(characters / multipart)
}

export function countSmsSegments(text: string): SmsSegmentCount {
  const body = String(text ?? '')
  const septets = countGsm7Septets(body)

  if (septets >= 0) {
    return {
      encoding: 'GSM-7',
      characters: septets,
      segments: segmentsFor(
        septets,
        GSM7_SINGLE_SEGMENT_LIMIT,
        GSM7_MULTIPART_SEGMENT_LIMIT,
      ),
    }
  }

  // UCS-2 is counted in UTF-16 code units: `length` already counts a
  // surrogate pair (emoji, many CJK) as two.
  const codeUnits = body.length
  return {
    encoding: 'UCS-2',
    characters: codeUnits,
    segments: segmentsFor(
      codeUnits,
      UCS2_SINGLE_SEGMENT_LIMIT,
      UCS2_MULTIPART_SEGMENT_LIMIT,
    ),
  }
}
