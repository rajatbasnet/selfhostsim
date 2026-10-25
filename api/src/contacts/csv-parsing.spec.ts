import {
  normalizeCsvHeader,
  parseCsvRows,
  parseCsvWithHeader,
} from './csv-parsing'

describe('csv-parsing', () => {
  describe('parseCsvRows', () => {
    it('splits plain rows on commas and LF', () => {
      expect(parseCsvRows('a,b,c\n1,2,3\n')).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ])
    })

    it('handles CRLF, lone CR and mixed line endings', () => {
      expect(parseCsvRows('a,b\r\n1,2\r3,4\n5,6')).toEqual([
        ['a', 'b'],
        ['1', '2'],
        ['3', '4'],
        ['5', '6'],
      ])
    })

    it('keeps commas inside quoted fields', () => {
      expect(
        parseCsvRows('name,phone\n"Shrestha, Asha",+9779801234567'),
      ).toEqual([
        ['name', 'phone'],
        ['Shrestha, Asha', '+9779801234567'],
      ])
    })

    it('keeps newlines inside quoted fields', () => {
      expect(
        parseCsvRows('note,phone\n"line one\r\nline two",+9779801234567'),
      ).toEqual([
        ['note', 'phone'],
        ['line one\r\nline two', '+9779801234567'],
      ])
    })

    it('decodes doubled quotes inside quoted fields', () => {
      expect(parseCsvRows('"She said ""hi""",x')).toEqual([
        ['She said "hi"', 'x'],
      ])
    })

    it('keeps a quote in the middle of an unquoted field literally', () => {
      expect(parseCsvRows('5\'10",x')).toEqual([['5\'10"', 'x']])
    })

    it('strips a UTF-8 BOM at the start of the file', () => {
      expect(parseCsvRows('﻿name,phone\nA,1')).toEqual([
        ['name', 'phone'],
        ['A', '1'],
      ])
    })

    it('does not strip a BOM-like character later in the file', () => {
      expect(parseCsvRows('a\n﻿b')).toEqual([['a'], ['﻿b']])
    })

    it('preserves empty fields, including trailing ones', () => {
      expect(parseCsvRows('a,,c\n,,\nx,')).toEqual([
        ['a', '', 'c'],
        ['x', ''],
      ])
    })

    it('represents an empty quoted field as an empty string, not a missing cell', () => {
      expect(parseCsvRows('"",b')).toEqual([['', 'b']])
    })

    it('skips blank and whitespace-only lines', () => {
      expect(parseCsvRows('a,b\n\n   \n1,2\n\n')).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ])
    })

    it('handles a file with no trailing newline', () => {
      expect(parseCsvRows('a,b\n1,2')).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ])
    })

    it('handles an unterminated quoted field at EOF without hanging or throwing', () => {
      expect(parseCsvRows('a,"un终')).toEqual([['a', 'un终']])
    })

    it('returns [] for empty, whitespace-only and non-string input', () => {
      expect(parseCsvRows('')).toEqual([])
      expect(parseCsvRows('\n\r\n  \n')).toEqual([])
      expect(parseCsvRows(undefined as unknown as string)).toEqual([])
    })
  })

  describe('normalizeCsvHeader', () => {
    it('lowercases, trims and collapses separators to underscores', () => {
      expect(normalizeCsvHeader(' Phone Number ')).toBe('phone_number')
      expect(normalizeCsvHeader('phone-number')).toBe('phone_number')
      expect(normalizeCsvHeader('Phone.Number')).toBe('phone_number')
      expect(normalizeCsvHeader('PHONE__NUMBER')).toBe('phone_number')
      expect(normalizeCsvHeader('_tags_')).toBe('tags')
    })

    it('drops a BOM glued to the first header cell', () => {
      expect(normalizeCsvHeader('﻿Name')).toBe('name')
    })
  })

  describe('parseCsvWithHeader', () => {
    it('keys each row by the normalised header', () => {
      const parsed = parseCsvWithHeader(
        'Full Name,Phone Number,Email\nAsha,+9779801234567,asha@example.com\n',
      )
      expect(parsed.header).toEqual(['full_name', 'phone_number', 'email'])
      expect(parsed.rows).toEqual([
        {
          full_name: 'Asha',
          phone_number: '+9779801234567',
          email: 'asha@example.com',
        },
      ])
    })

    it('pads short rows with empty strings so no key is ever missing', () => {
      const parsed = parseCsvWithHeader('name,phone,email\nAsha,+9779801234567')
      expect(parsed.rows).toEqual([
        { name: 'Asha', phone: '+9779801234567', email: '' },
      ])
    })

    it('drops cells beyond the header width', () => {
      const parsed = parseCsvWithHeader('name,phone\nAsha,+9779801234567,extra')
      expect(parsed.rows).toEqual([{ name: 'Asha', phone: '+9779801234567' }])
    })

    it('trims cell whitespace', () => {
      const parsed = parseCsvWithHeader(
        'name,phone\n  Asha  , +977 980 123 4567 ',
      )
      expect(parsed.rows[0]).toEqual({
        name: 'Asha',
        phone: '+977 980 123 4567',
      })
    })

    it('keeps the first of duplicate header names and ignores empty headers', () => {
      const parsed = parseCsvWithHeader('name,,name,phone\nA,ignored,B,1')
      expect(parsed.header).toEqual(['name', 'phone'])
      expect(parsed.rows).toEqual([{ name: 'A', phone: '1' }])
    })

    it('returns empty header and rows for empty input', () => {
      expect(parseCsvWithHeader('')).toEqual({ header: [], rows: [] })
    })

    it('returns a header but no rows for a header-only file', () => {
      expect(parseCsvWithHeader('name,phone\n')).toEqual({
        header: ['name', 'phone'],
        rows: [],
      })
    })
  })
})
