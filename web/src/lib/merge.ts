import { firstName, lastName } from './format'
import type { Contact } from './types'

export const MERGE_TAGS = ['first_name', 'last_name', 'name', 'tag', 'shop_name', 'phone', 'email'] as const

export function mergeVars(contact: Partial<Contact> | undefined, extra: Record<string, string> = {}): Record<string, string> {
  const c = contact ?? {}
  const first = firstName(c)
  const last = lastName(c)
  return {
    first_name: first,
    last_name: last,
    name: [first, last].filter(Boolean).join(' '),
    tag: c.tags?.[0] ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    ...(c.attributes ?? {}),
    ...extra,
  }
}

/** Replace {{tag}} with its value. Unknown tags become empty, never "undefined". */
export function renderMerge(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

export function findMergeTags(template: string): string[] {
  const out = new Set<string>()
  for (const m of template.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) out.add(m[1])
  return Array.from(out)
}
