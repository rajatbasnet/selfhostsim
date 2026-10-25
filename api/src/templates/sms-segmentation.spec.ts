import { countSmsSegments, isGsm7 } from './sms-segmentation'

describe('countSmsSegments', () => {
  it('returns zero segments for an empty message', () => {
    expect(countSmsSegments('')).toEqual({
      encoding: 'GSM-7',
      characters: 0,
      segments: 0,
    })
  })

  it('counts exactly 160 GSM-7 characters as one segment', () => {
    const text = 'a'.repeat(160)

    expect(countSmsSegments(text)).toEqual({
      encoding: 'GSM-7',
      characters: 160,
      segments: 1,
    })
  })

  it('counts 161 GSM-7 characters as two segments', () => {
    const text = 'a'.repeat(161)

    expect(countSmsSegments(text)).toEqual({
      encoding: 'GSM-7',
      characters: 161,
      segments: 2,
    })
  })

  it('uses 153 per part for concatenated GSM-7', () => {
    expect(countSmsSegments('a'.repeat(306)).segments).toBe(2)
    expect(countSmsSegments('a'.repeat(307)).segments).toBe(3)
  })

  it('counts GSM extension characters as two', () => {
    expect(countSmsSegments('{')).toEqual({
      encoding: 'GSM-7',
      characters: 2,
      segments: 1,
    })
    expect(countSmsSegments('^{}[]~\\|€').characters).toBe(18)
  })

  it('flips to two segments when an extension char pushes past 160', () => {
    // 159 plain + one brace = 161 septets
    const text = 'a'.repeat(159) + '{'

    expect(countSmsSegments(text)).toEqual({
      encoding: 'GSM-7',
      characters: 161,
      segments: 2,
    })
  })

  it('accepts the GSM basic alphabet beyond ASCII', () => {
    const text = '@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà\n\r'

    expect(countSmsSegments(text).encoding).toBe('GSM-7')
    expect(isGsm7(text)).toBe(true)
  })

  it('flips to UCS-2 and the 70 limit for a single emoji', () => {
    const text = 'a'.repeat(68) + '😀'

    const result = countSmsSegments(text)

    expect(result.encoding).toBe('UCS-2')
    // the emoji is a surrogate pair and costs two code units
    expect(result.characters).toBe(70)
    expect(result.segments).toBe(1)
    expect(countSmsSegments('a'.repeat(69) + '😀').segments).toBe(2)
  })

  it('flips to UCS-2 for Devanagari', () => {
    const result = countSmsSegments('नमस्ते')

    expect(result.encoding).toBe('UCS-2')
    expect(result.characters).toBe(6)
    expect(result.segments).toBe(1)
  })

  it('flips to UCS-2 for smart quotes and other non-GSM punctuation', () => {
    expect(countSmsSegments('it’s').encoding).toBe('UCS-2')
    expect(countSmsSegments('a—b').encoding).toBe('UCS-2')
    expect(countSmsSegments('`').encoding).toBe('UCS-2')
  })

  it('uses 67 per part for concatenated UCS-2', () => {
    const text = '😀'.repeat(67) // 134 code units

    expect(countSmsSegments(text)).toEqual({
      encoding: 'UCS-2',
      characters: 134,
      segments: 2,
    })
    expect(countSmsSegments('😀'.repeat(68)).segments).toBe(3)
  })
})
