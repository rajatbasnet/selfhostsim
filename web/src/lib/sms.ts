// SMS segment math. 160 GSM-7 characters is one message; 161 is two.
// One emoji (or any non-GSM character) switches the whole message to
// UCS-2 and the limit silently drops to 70.

const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_EXTENDED = '^{}\\[~]|€'

export interface SmsCount {
  characters: number
  encoding: 'GSM-7' | 'Unicode'
  segments: number
  perSegment: number
  remainingInSegment: number
  hasEmoji: boolean
}

export function countSms(text: string): SmsCount {
  let gsm = true
  let units = 0
  let hasEmoji = false
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) units += 1
    else if (GSM_EXTENDED.includes(ch)) units += 2
    else {
      gsm = false
      const cp = ch.codePointAt(0) ?? 0
      if (cp > 0xffff) hasEmoji = true
      break
    }
  }
  if (!gsm) {
    // UCS-2: count UTF-16 code units
    units = text.length
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0
      if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf)) hasEmoji = true
    }
  }
  const single = gsm ? 160 : 70
  const multi = gsm ? 153 : 67
  let segments: number
  let perSegment: number
  if (units === 0) {
    segments = 0
    perSegment = single
  } else if (units <= single) {
    segments = 1
    perSegment = single
  } else {
    segments = Math.ceil(units / multi)
    perSegment = multi
  }
  const used = segments <= 1 ? units : units - (segments - 1) * multi
  return {
    characters: units,
    encoding: gsm ? 'GSM-7' : 'Unicode',
    segments,
    perSegment,
    remainingInSegment: Math.max(0, perSegment - used),
    hasEmoji,
  }
}

export const STOP_LINE = 'Reply STOP to opt out.'

export function hasStopLine(text: string): boolean {
  return /\bstop\b/i.test(text)
}

export function withStopLine(text: string): string {
  if (hasStopLine(text)) return text
  const t = text.replace(/\s+$/, '')
  return t ? `${t} ${STOP_LINE}` : STOP_LINE
}

export function describeSms(text: string): string {
  const c = countSms(text)
  const segs = c.segments === 1 ? '1 SMS' : `${c.segments} SMS`
  let s = `${c.characters} ${c.characters === 1 ? 'character' : 'characters'} · ${segs}`
  if (c.encoding === 'Unicode') {
    s += c.hasEmoji ? ' · an emoji dropped the limit to 70' : ' · special characters drop the limit to 70'
  }
  return s
}
