import {
  extractMergeTags,
  lookupMergeTagValue,
  renderTemplate,
} from './merge-tag-rendering'

describe('renderTemplate', () => {
  it('substitutes a simple tag', () => {
    const result = renderTemplate('Hi {{first_name}}!', { first_name: 'Ada' })

    expect(result.text).toBe('Hi Ada!')
    expect(result.missing).toEqual([])
  })

  it('tolerates whitespace inside the braces', () => {
    const result = renderTemplate('Hi {{ first_name }} and {{  last_name}}', {
      first_name: 'Ada',
      last_name: 'Lovelace',
    })

    expect(result.text).toBe('Hi Ada and Lovelace')
    expect(result.missing).toEqual([])
  })

  it('renders a missing tag as an empty string and reports it', () => {
    const result = renderTemplate('Hi {{first_name}}, welcome!', {})

    expect(result.text).toBe('Hi , welcome!')
    expect(result.missing).toEqual(['first_name'])
    expect(result.text).not.toContain('{{')
  })

  it('treats null and undefined as missing but keeps falsy values', () => {
    const result = renderTemplate('{{a}}|{{b}}|{{c}}|{{d}}|{{e}}', {
      a: null,
      b: undefined,
      c: 0,
      d: false,
      e: '',
    })

    expect(result.text).toBe('||0|false|')
    expect(result.missing).toEqual(['a', 'b'])
  })

  it('reports each missing tag once', () => {
    const result = renderTemplate('{{x}} {{x}} {{ x }}', {})

    expect(result.text).toBe('  ')
    expect(result.missing).toEqual(['x'])
  })

  it('coerces values with String()', () => {
    const result = renderTemplate('{{n}} {{d}}', {
      n: 42,
      d: { toString: () => 'custom' },
    })

    expect(result.text).toBe('42 custom')
  })

  it('resolves nested dotted lookups', () => {
    const result = renderTemplate('Thanks from {{attributes.shop_name}}', {
      attributes: { shop_name: 'Your Shop' },
    })

    expect(result.text).toBe('Thanks from Your Shop')
    expect(result.missing).toEqual([])
  })

  it('reports a broken dotted path as missing', () => {
    const result = renderTemplate('{{attributes.missing.deeper}}', {
      attributes: { shop_name: 'x' },
    })

    expect(result.text).toBe('')
    expect(result.missing).toEqual(['attributes.missing.deeper'])
  })

  it('prefers a flat key that contains dots', () => {
    const result = renderTemplate('{{a.b}}', {
      'a.b': 'flat',
      a: { b: 'nested' },
    })

    expect(result.text).toBe('flat')
  })

  it('never walks into the prototype chain', () => {
    const proto = renderTemplate('{{__proto__}}', { first_name: 'Ada' })
    expect(proto.text).toBe('')
    expect(proto.missing).toEqual(['__proto__'])

    const ctor = renderTemplate('{{constructor}}|{{constructor.name}}', {})
    expect(ctor.text).toBe('|')
    expect(ctor.missing).toEqual(['constructor', 'constructor.name'])

    const nested = renderTemplate('{{a.__proto__.polluted}}', { a: {} })
    expect(nested.text).toBe('')

    const inherited = renderTemplate('{{toString}}|{{a.prototype}}', {
      a: {},
    })
    expect(inherited.text).toBe('|')
  })

  it('leaves malformed tags untouched as literal text', () => {
    const body = '{{first name}} {{ }} {{a b}} {{$x}} {{a}} {single}'
    const result = renderTemplate(body, { a: 'A' })

    expect(result.text).toBe('{{first name}} {{ }} {{a b}} {{$x}} A {single}')
    expect(result.missing).toEqual([])
  })

  it('does not evaluate anything that looks like code', () => {
    const body = '{{process.exit}} ${1+1} {{ `x` }}'
    const result = renderTemplate(body, {})

    expect(result.text).toBe(' ${1+1} {{ `x` }}')
    expect(result.missing).toEqual(['process.exit'])
  })

  it('handles an empty body and null vars', () => {
    expect(renderTemplate('', {})).toEqual({ text: '', missing: [] })
    expect(renderTemplate('{{a}}', null as any)).toEqual({
      text: '',
      missing: ['a'],
    })
  })
})

describe('lookupMergeTagValue', () => {
  it('returns undefined for non-object sources', () => {
    expect(lookupMergeTagValue(null, 'a')).toBeUndefined()
    expect(lookupMergeTagValue('str', 'length')).toBeUndefined()
    expect(lookupMergeTagValue(42, 'toFixed')).toBeUndefined()
  })

  it('does not read through a string primitive midway', () => {
    expect(lookupMergeTagValue({ a: 'abc' }, 'a.length')).toBeUndefined()
  })
})

describe('extractMergeTags', () => {
  it('lists distinct tags in order', () => {
    expect(extractMergeTags('{{b}} {{ a }} {{b}} {{c.d}} {{bad tag}}')).toEqual(
      ['b', 'a', 'c.d'],
    )
  })
})
