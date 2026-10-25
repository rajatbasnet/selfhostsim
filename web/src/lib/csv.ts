// A small, forgiving CSV parser plus a column guesser, so the import
// dialog can show "what we found" before anything is saved.

export interface ParsedRow {
  name?: string
  phone?: string
  email?: string
  tags?: string[]
  smsConsent?: boolean
  emailConsent?: boolean
  consentSource?: string
  consentAt?: string
  raw: Record<string, string>
}

export interface CsvSummary {
  rows: number
  withPhone: number
  withEmail: number
  withNeither: number
  withConsent: number
  withoutConsent: number
  duplicatePhones: number
  columns: string[]
  unmappedColumns: string[]
  mapped: Record<string, string>
  sample: ParsedRow[]
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === ',' || ch === '\t' || ch === ';') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

const COLUMN_GUESSES: Record<string, string[]> = {
  name: ['name', 'full name', 'fullname', 'contact', 'customer'],
  first_name: ['first name', 'firstname', 'first', 'given name'],
  last_name: ['last name', 'lastname', 'last', 'surname', 'family name'],
  phone: ['phone', 'mobile', 'number', 'phone number', 'cell', 'tel', 'telephone', 'msisdn', 'whatsapp'],
  email: ['email', 'e-mail', 'mail', 'email address'],
  tags: ['tags', 'tag', 'group', 'groups', 'segment', 'label'],
  sms_consent: ['sms consent', 'sms_consent', 'smsconsent', 'sms ok', 'consent', 'opt in', 'optin', 'opted in', 'subscribed', 'sms opt in'],
  email_consent: ['email consent', 'email_consent', 'emailconsent', 'email ok', 'email opt in', 'newsletter'],
  consent_source: ['consent source', 'consent_source', 'source', 'origin', 'signed up via', 'where'],
  consent_at: ['consent at', 'consent_at', 'consent date', 'opted in at', 'signup date', 'date', 'created'],
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

export function guessColumns(header: string[]): Record<string, string> {
  const mapped: Record<string, string> = {}
  const taken = new Set<string>()
  for (const [field, names] of Object.entries(COLUMN_GUESSES)) {
    for (const h of header) {
      if (taken.has(h)) continue
      if (names.includes(norm(h))) {
        mapped[field] = h
        taken.add(h)
        break
      }
    }
  }
  return mapped
}

export function truthy(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined
  const s = v.trim().toLowerCase()
  if (!s) return undefined
  if (['yes', 'y', 'true', '1', 'ok', 'opted in', 'opt in', 'subscribed', 'granted'].includes(s)) return true
  if (['no', 'n', 'false', '0', 'stop', 'opted out', 'unsubscribed', 'none'].includes(s)) return false
  return undefined
}

export function normalisePhone(v: string | undefined): string | undefined {
  if (!v) return undefined
  const s = v.replace(/[^\d+]/g, '')
  if (!s) return undefined
  if (s.startsWith('+')) return s
  if (s.startsWith('00')) return `+${s.slice(2)}`
  return s
}

export function summariseCsv(text: string, defaults: { smsConsent?: boolean; emailConsent?: boolean; consentSource?: string } = {}): CsvSummary | null {
  const grid = parseCsv(text)
  if (grid.length === 0) return null
  const header = grid[0].map((h) => h.trim())
  const looksLikeHeader = header.some((h) => /[a-zA-Z]/.test(h) && !/@/.test(h) && !/^\+?\d/.test(h))
  const mapped = looksLikeHeader ? guessColumns(header) : {}
  const dataRows = looksLikeHeader ? grid.slice(1) : grid
  const cols = looksLikeHeader ? header : header.map((_, i) => `Column ${i + 1}`)

  const rows: ParsedRow[] = dataRows.map((cells) => {
    const raw: Record<string, string> = {}
    cols.forEach((c, i) => (raw[c] = (cells[i] ?? '').trim()))
    const get = (f: string) => (mapped[f] ? raw[mapped[f]] : undefined)
    let name = get('name')
    if (!name) name = [get('first_name'), get('last_name')].filter(Boolean).join(' ') || undefined
    let phone = normalisePhone(get('phone'))
    let email = get('email')?.toLowerCase() || undefined
    if (!looksLikeHeader) {
      // Headerless file: sniff each cell.
      for (const v of cells) {
        const t = v.trim()
        if (!email && /@/.test(t)) email = t.toLowerCase()
        else if (!phone && /^\+?[\d\s().-]{7,}$/.test(t)) phone = normalisePhone(t)
        else if (!name && /[a-zA-Z]/.test(t)) name = t
      }
    }
    const sms = truthy(get('sms_consent'))
    const em = truthy(get('email_consent'))
    const tags = get('tags')
      ?.split(/[;,|]/)
      .map((t) => t.trim())
      .filter(Boolean)
    return {
      name,
      phone,
      email,
      tags: tags && tags.length ? tags : undefined,
      smsConsent: sms ?? defaults.smsConsent,
      emailConsent: em ?? defaults.emailConsent,
      consentSource: get('consent_source') || defaults.consentSource,
      consentAt: get('consent_at'),
      raw,
    }
  })

  const seen = new Set<string>()
  let duplicatePhones = 0
  for (const r of rows) {
    if (!r.phone) continue
    if (seen.has(r.phone)) duplicatePhones++
    else seen.add(r.phone)
  }
  const withConsent = rows.filter((r) => r.smsConsent === true || r.emailConsent === true).length
  const mappedCols = new Set(Object.values(mapped))
  return {
    rows: rows.length,
    withPhone: rows.filter((r) => r.phone).length,
    withEmail: rows.filter((r) => r.email).length,
    withNeither: rows.filter((r) => !r.phone && !r.email).length,
    withConsent,
    withoutConsent: rows.length - withConsent,
    duplicatePhones,
    columns: cols,
    unmappedColumns: cols.filter((c) => !mappedCols.has(c)),
    mapped,
    sample: rows.slice(0, 5),
  }
}
