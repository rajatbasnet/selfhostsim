/**
 * A small RFC 4180 style CSV reader for contact imports.
 *
 * Written here rather than pulled in as a dependency because the surface we
 * need is tiny and the failure modes we care about (a comma inside a quoted
 * name, a doubled quote, a spreadsheet that saved with CRLF and a BOM) are
 * easier to reason about in sixty lines we own than in a library we configure.
 */

export interface ParsedCsv {
  /** Header cells, trimmed, in file order. */
  header: string[]
  /** One record per data row, keyed by header cell. Missing cells are ''. */
  rows: Record<string, string>[]
}

/**
 * Splits CSV text into rows of raw string fields.
 *
 * - Fields may be quoted with double quotes; a quoted field may contain
 *   commas, CR/LF and doubled quotes ("") which decode to one quote.
 * - Line endings may be CRLF, LF or a lone CR, mixed freely.
 * - A UTF-8 BOM at the start of the text is dropped.
 * - Blank lines (nothing but whitespace) are skipped.
 */
export function parseCsvRows(text: string): string[][] {
  if (typeof text !== 'string') return []

  let input = text
  if (input.charCodeAt(0) === 0xfeff) {
    input = input.slice(1)
  }

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldWasQuoted = false

  const endField = () => {
    row.push(field)
    field = ''
    fieldWasQuoted = false
  }

  const endRow = () => {
    endField()
    // A line that is only whitespace (or completely empty) is not a record.
    const isBlank = row.every((cell) => cell.trim() === '')
    if (!isBlank) rows.push(row)
    row = []
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      // Only a quote at the very start of a field opens quoting. A quote in
      // the middle of an unquoted field is kept literally, which is what every
      // spreadsheet does with 5'10" style content.
      if (field === '' && !fieldWasQuoted) {
        inQuotes = true
        fieldWasQuoted = true
      } else {
        field += ch
      }
    } else if (ch === ',') {
      endField()
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++
      endRow()
    } else if (ch === '\n') {
      endRow()
    } else {
      field += ch
    }
  }

  // Flush the last record when the file has no trailing newline.
  if (field !== '' || fieldWasQuoted || row.length > 0) {
    endRow()
  }

  return rows
}

/**
 * Lowercases, trims and collapses the ways people write the same header:
 * 'Phone Number', 'phone_number', 'phone-number' and ' PHONE NUMBER ' all
 * become 'phone_number'.
 */
export function normalizeCsvHeader(header: string): string {
  return header
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * Parses CSV text that has a header row into keyed records.
 *
 * Header cells are normalised with normalizeCsvHeader. Duplicate header names
 * keep the first occurrence and are listed once; an empty header cell is ignored. Rows shorter
 * than the header are padded with ''; longer rows have the extra cells
 * dropped, since there is no name to file them under.
 */
export function parseCsvWithHeader(text: string): ParsedCsv {
  const rawRows = parseCsvRows(text)
  if (rawRows.length === 0) {
    return { header: [], rows: [] }
  }

  const header = rawRows[0].map(normalizeCsvHeader)
  const rows: Record<string, string>[] = []

  for (const cells of rawRows.slice(1)) {
    const record: Record<string, string> = {}
    header.forEach((key, index) => {
      if (!key) return
      if (key in record) return
      const value = cells[index]
      record[key] = typeof value === 'string' ? value.trim() : ''
    })
    rows.push(record)
  }

  return { header: [...new Set(header.filter(Boolean))], rows }
}
