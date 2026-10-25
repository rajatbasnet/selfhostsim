/**
 * Merge-tag rendering for message templates.
 *
 * Templates are user-supplied text. This module does plain string
 * substitution and nothing else: no eval, no Function, no template-literal
 * execution. A tag is `{{name}}` where name is `[a-zA-Z0-9_.-]+`; inner
 * whitespace is tolerated (`{{ name }}`). Anything that is not a well-formed
 * tag is left untouched as literal text.
 *
 * A tag without a value renders as an EMPTY string and is reported in
 * `missing`. A real person must never receive a literal `{{first_name}}`.
 */

const TAG_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g

/** Path segments that would walk into the prototype chain. Never followed. */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export interface RenderedTemplate {
  /** The body with every tag substituted. Missing tags become ''. */
  text: string
  /** Tag names (as written, minus whitespace) that had no value. Deduplicated. */
  missing: string[]
}

export type MergeTagVars = Record<string, unknown>

const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key)

/**
 * Safely resolves a dotted path (`attributes.shop_name`) against `source`.
 *
 * Only own properties are read, so inherited members such as `toString` are
 * never exposed, and segments that would reach the prototype chain are
 * rejected outright. Returns undefined for anything that cannot be resolved.
 */
export function lookupMergeTagValue(source: unknown, path: string): unknown {
  if (source === null || source === undefined || typeof source !== 'object') {
    return undefined
  }

  // A flat key that happens to contain dots wins over path walking, so
  // callers may pass { 'attributes.shop_name': 'x' } if they prefer.
  if (!FORBIDDEN_SEGMENTS.has(path) && hasOwn(source as object, path)) {
    return (source as Record<string, unknown>)[path]
  }

  let current: unknown = source
  for (const segment of path.split('.')) {
    if (segment === '' || FORBIDDEN_SEGMENTS.has(segment)) {
      return undefined
    }
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object' ||
      !hasOwn(current as object, segment)
    ) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * Renders `body` by substituting every `{{tag}}` with `String(vars[tag])`.
 *
 * null and undefined values count as missing and render as ''. All other
 * values (including 0, false and '') are coerced with String().
 */
export function renderTemplate(
  body: string,
  vars: MergeTagVars,
): RenderedTemplate {
  const missing: string[] = []
  const source = vars ?? {}

  const text = String(body ?? '').replace(
    TAG_PATTERN,
    (_match, tag: string) => {
      const value = lookupMergeTagValue(source, tag)
      if (value === null || value === undefined) {
        if (!missing.includes(tag)) {
          missing.push(tag)
        }
        return ''
      }
      return String(value)
    },
  )

  return { text, missing }
}

/** Lists the distinct tag names referenced by `body`, in order of appearance. */
export function extractMergeTags(body: string): string[] {
  const tags: string[] = []
  for (const match of String(body ?? '').matchAll(TAG_PATTERN)) {
    if (!tags.includes(match[1])) {
      tags.push(match[1])
    }
  }
  return tags
}
