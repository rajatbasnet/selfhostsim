import {
  compileListFilter,
  normalizeListFilter,
} from './list-filter-compilation'

describe('compileListFilter', () => {
  it('compiles an empty filter to an empty query', () => {
    expect(compileListFilter({})).toEqual({})
  })

  it('compiles null, undefined, arrays and primitives to an empty query', () => {
    expect(compileListFilter(null)).toEqual({})
    expect(compileListFilter(undefined)).toEqual({})
    expect(compileListFilter([{ hasPhone: true }])).toEqual({})
    expect(compileListFilter('hasPhone')).toEqual({})
  })

  it('ignores unknown keys', () => {
    const query = compileListFilter({
      hasPhone: true,
      optedOutAt: null,
      $where: 'this.user',
      user: 'someone-else',
    } as any)

    expect(query).toEqual({ phone: { $nin: [null, ''] } })
    expect(Object.keys(query)).toEqual(['phone'])
  })

  it('does not pass operator objects through documented keys', () => {
    const query = compileListFilter({
      tagsInclude: [{ $ne: null }, 'vip', 42, ''],
      smsConsent: { $exists: true },
      createdAfter: { $gt: '2020' },
    } as any)

    expect(query).toEqual({ tags: { $in: ['vip'] } })
  })

  it('compiles tag include and exclude together', () => {
    const query = compileListFilter({
      tagsInclude: ['vip', ' vip ', 'new'],
      tagsExclude: ['churned'],
    })

    expect(query).toEqual({
      tags: { $in: ['vip', 'new'], $nin: ['churned'] },
    })
  })

  it('compiles presence and consent flags', () => {
    expect(
      compileListFilter({
        hasPhone: false,
        hasEmail: true,
        smsConsent: true,
        emailConsent: false,
      }),
    ).toEqual({
      phone: { $in: [null, ''] },
      email: { $nin: [null, ''] },
      smsConsent: true,
      emailConsent: false,
    })
  })

  it('ignores non-boolean flags', () => {
    expect(
      compileListFilter({ hasPhone: 'true', smsConsent: 1 } as any),
    ).toEqual({})
  })

  it('compiles a created-at range from Dates or ISO strings', () => {
    const after = new Date('2024-01-01T00:00:00.000Z')

    expect(
      compileListFilter({
        createdAfter: after,
        createdBefore: '2024-12-31T00:00:00.000Z' as any,
      }),
    ).toEqual({
      createdAt: {
        $gte: after,
        $lte: new Date('2024-12-31T00:00:00.000Z'),
      },
    })
  })

  it('drops invalid dates', () => {
    expect(
      compileListFilter({
        createdAfter: 'not a date',
        createdBefore: new Date('x'),
      } as any),
    ).toEqual({})
  })
})

describe('normalizeListFilter', () => {
  it('returns only the documented keys with clean values', () => {
    expect(
      normalizeListFilter({
        tagsInclude: ['a', 'a', ' '],
        bogus: true,
        hasEmail: true,
      }),
    ).toEqual({ tagsInclude: ['a'], hasEmail: true })
  })
})
