import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { HttpException, HttpStatus } from '@nestjs/common'
import { Types } from 'mongoose'
import { ContactsService, escapeRegExp } from './contacts.service'
import { Contact } from './schemas/contact.schema'
import { User } from '../users/schemas/user.schema'

/** Builds the chainable query object Mongoose returns from find(). */
function queryChain(result: unknown) {
  const chain: Record<string, jest.Mock> = {}
  for (const method of ['sort', 'skip', 'limit', 'select']) {
    chain[method] = jest.fn().mockReturnValue(chain)
  }
  chain.lean = jest.fn().mockResolvedValue(result)
  return chain
}

function statusOf(error: unknown): number | undefined {
  return error instanceof HttpException ? error.getStatus() : undefined
}

describe('ContactsService', () => {
  let service: ContactsService

  const user = { _id: new Types.ObjectId() } as unknown as User
  const otherUserId = new Types.ObjectId()

  const mockContactModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    countDocuments: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: getModelToken(Contact.name), useValue: mockContactModel },
      ],
    }).compile()

    service = module.get<ContactsService>(ContactsService)

    jest.clearAllMocks()
    mockContactModel.findOne.mockResolvedValue(null)
    mockContactModel.create.mockImplementation(async (doc) => ({
      _id: new Types.ObjectId(),
      ...doc,
    }))
    mockContactModel.find.mockReturnValue(queryChain([]))
    mockContactModel.updateOne.mockResolvedValue({ modifiedCount: 1 })
    mockContactModel.countDocuments.mockResolvedValue(0)
  })

  describe('createContact', () => {
    it('normalises phone and email before saving and scopes to the user', async () => {
      await service.createContact(
        {
          name: '  Asha ',
          phone: '0980-123-4567',
          email: ' Asha@Example.com ',
          defaultCountryCode: '977',
        },
        user,
      )

      expect(mockContactModel.create).toHaveBeenCalledTimes(1)
      const doc = mockContactModel.create.mock.calls[0][0]
      expect(doc).toMatchObject({
        user: user._id,
        name: 'Asha',
        phone: '+9779801234567',
        email: 'asha@example.com',
        smsConsent: false,
        emailConsent: false,
        tags: [],
        attributes: {},
      })
      expect(doc.consentAt).toBeUndefined()
      expect(doc.consentSource).toBeUndefined()
    })

    it('checks for an existing contact with the same phone or email for this user only', async () => {
      await service.createContact({ phone: '+9779801234567' }, user)

      expect(mockContactModel.findOne).toHaveBeenCalledWith({
        user: user._id,
        $or: [{ phone: '+9779801234567' }],
      })
    })

    it('rejects a contact with neither phone nor email', async () => {
      await expect(
        service.createContact({ name: 'Nobody' }, user),
      ).rejects.toThrow(HttpException)
      await expect(
        service.createContact({ phone: '  ', email: '' }, user),
      ).rejects.toThrow(HttpException)
      expect(mockContactModel.create).not.toHaveBeenCalled()
    })

    it('rejects a phone number it cannot normalise instead of storing raw input', async () => {
      const error = await service
        .createContact({ phone: '9801234567' }, user)
        .catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST)
      expect(mockContactModel.create).not.toHaveBeenCalled()
    })

    it('rejects an invalid email even when the phone is fine', async () => {
      const error = await service
        .createContact({ phone: '+9779801234567', email: 'not-an-email' }, user)
        .catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST)
    })

    it('sets consentAt and consentSource when consent is granted with a source', async () => {
      const before = Date.now()
      await service.createContact(
        {
          phone: '+9779801234567',
          smsConsent: true,
          consentSource: 'web-form',
        },
        user,
      )
      const doc = mockContactModel.create.mock.calls[0][0]
      expect(doc.smsConsent).toBe(true)
      expect(doc.emailConsent).toBe(false)
      expect(doc.consentSource).toBe('web-form')
      expect(doc.consentAt).toBeInstanceOf(Date)
      expect(doc.consentAt.getTime()).toBeGreaterThanOrEqual(before)
    })

    it('refuses to record consent without a consentSource', async () => {
      const error = await service
        .createContact({ phone: '+9779801234567', emailConsent: true }, user)
        .catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST)
      expect(mockContactModel.create).not.toHaveBeenCalled()
    })

    it('returns 409 when a contact with the same phone already exists', async () => {
      mockContactModel.findOne.mockResolvedValue({ _id: new Types.ObjectId() })
      const error = await service
        .createContact({ phone: '+9779801234567' }, user)
        .catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.CONFLICT)
      expect(mockContactModel.create).not.toHaveBeenCalled()
    })

    it('maps a duplicate-key race on insert to 409', async () => {
      mockContactModel.create.mockRejectedValue({ code: 11000 })
      const error = await service
        .createContact({ email: 'asha@example.com' }, user)
        .catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.CONFLICT)
    })

    it('dedupes and trims tags and sanitises attribute keys', async () => {
      await service.createContact(
        {
          phone: '+9779801234567',
          tags: [' vip', 'vip', '', 'ktm '],
          attributes: { 'shop.name': 'X', $bad: 'y', ok: 1 } as never,
        },
        user,
      )
      const doc = mockContactModel.create.mock.calls[0][0]
      expect(doc.tags).toEqual(['vip', 'ktm'])
      expect(doc.attributes).toEqual({ shop_name: 'X', bad: 'y', ok: '1' })
    })
  })

  describe('getContactById', () => {
    it('returns 404 for a malformed id without hitting the database', async () => {
      const error = await service.getContactById('nope', user).catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND)
      expect(mockContactModel.findOne).not.toHaveBeenCalled()
    })

    it('returns 404 when the contact belongs to someone else', async () => {
      const id = new Types.ObjectId().toHexString()
      mockContactModel.findOne.mockResolvedValue(null)
      const error = await service.getContactById(id, user).catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND)
      expect(mockContactModel.findOne).toHaveBeenCalledWith({
        _id: id,
        user: user._id,
      })
    })
  })

  describe('updateContact', () => {
    const existing = {
      _id: new Types.ObjectId(),
      user: user._id,
      name: 'Asha',
      phone: '+9779801234567',
      email: undefined,
      smsConsent: false,
      emailConsent: false,
      consentSource: undefined,
    }

    beforeEach(() => {
      mockContactModel.findOne.mockImplementation(async (filter) =>
        filter._id && String(filter._id) === String(existing._id)
          ? { ...existing }
          : null,
      )
      mockContactModel.findOneAndUpdate.mockImplementation(
        async (_f, update) => ({ ...existing, ...update.$set }),
      )
    })

    it('normalises a new phone number', async () => {
      await service.updateContact(
        existing._id.toHexString(),
        { phone: '(415) 555-2671', defaultCountryCode: '1' },
        user,
      )
      const [, update] = mockContactModel.findOneAndUpdate.mock.calls[0]
      expect(update.$set.phone).toBe('+14155552671')
    })

    it('rejects a phone number it cannot normalise', async () => {
      const error = await service
        .updateContact(existing._id.toHexString(), { phone: 'abc' }, user)
        .catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST)
      expect(mockContactModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('refuses to clear the only address', async () => {
      const error = await service
        .updateContact(existing._id.toHexString(), { phone: '' }, user)
        .catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST)
    })

    it('allows clearing the phone once an email is present', async () => {
      await service.updateContact(
        existing._id.toHexString(),
        { phone: '', email: 'Asha@Example.com' },
        user,
      )
      const [, update] = mockContactModel.findOneAndUpdate.mock.calls[0]
      expect(update.$unset).toEqual({ phone: 1 })
      expect(update.$set.email).toBe('asha@example.com')
    })

    it('stamps consentAt when consent is newly granted', async () => {
      await service.updateContact(
        existing._id.toHexString(),
        { smsConsent: true, consentSource: 'pos' },
        user,
      )
      const [, update] = mockContactModel.findOneAndUpdate.mock.calls[0]
      expect(update.$set.smsConsent).toBe(true)
      expect(update.$set.consentSource).toBe('pos')
      expect(update.$set.consentAt).toBeInstanceOf(Date)
    })

    it('refuses to grant consent with no source anywhere', async () => {
      const error = await service
        .updateContact(existing._id.toHexString(), { smsConsent: true }, user)
        .catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST)
    })

    it('sets and clears optedOutAt', async () => {
      await service.updateContact(
        existing._id.toHexString(),
        { optedOut: true },
        user,
      )
      expect(
        mockContactModel.findOneAndUpdate.mock.calls[0][1].$set.optedOutAt,
      ).toBeInstanceOf(Date)

      await service.updateContact(
        existing._id.toHexString(),
        { optedOut: false },
        user,
      )
      expect(mockContactModel.findOneAndUpdate.mock.calls[1][1].$unset).toEqual(
        { optedOutAt: 1 },
      )
    })

    it("returns 404 for someone else's contact", async () => {
      const error = await service
        .updateContact(new Types.ObjectId().toHexString(), { name: 'x' }, user)
        .catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('deleteContact', () => {
    it('deletes only within the user scope', async () => {
      const id = new Types.ObjectId()
      mockContactModel.findOne.mockResolvedValue({ _id: id, user: user._id })
      mockContactModel.deleteOne.mockResolvedValue({ deletedCount: 1 })

      await service.deleteContact(id.toHexString(), user)

      expect(mockContactModel.deleteOne).toHaveBeenCalledWith({
        _id: id,
        user: user._id,
      })
    })
  })

  describe('listContacts', () => {
    it('returns data and pagination meta', async () => {
      const docs = [{ name: 'A' }, { name: 'B' }]
      mockContactModel.find.mockReturnValue(queryChain(docs))
      mockContactModel.countDocuments.mockResolvedValue(53)

      const result = await service.listContacts(user, { page: 2, limit: 25 })

      expect(result.data).toBe(docs)
      expect(result.meta).toEqual({
        page: 2,
        limit: 25,
        total: 53,
        totalPages: 3,
      })
      const chain = mockContactModel.find.mock.results[0].value
      expect(chain.skip).toHaveBeenCalledWith(25)
      expect(chain.limit).toHaveBeenCalledWith(25)
    })

    it('caps limit at 100 and floors page at 1', async () => {
      const result = await service.listContacts(user, { page: -3, limit: 9999 })
      expect(result.meta.page).toBe(1)
      expect(result.meta.limit).toBe(100)
    })

    it('escapes regex metacharacters in search instead of interpreting them', async () => {
      await service.listContacts(user, { search: 'a.b+c(' })
      const filter = mockContactModel.find.mock.calls[0][0]
      const pattern: RegExp = filter.$or[0].name
      expect(pattern).toBeInstanceOf(RegExp)
      expect(pattern.flags).toContain('i')
      expect(pattern.test('A.B+C(')).toBe(true)
      expect(pattern.test('axb+c(')).toBe(false)
      expect(filter.$or.map((c) => Object.keys(c)[0])).toEqual([
        'name',
        'phone',
        'email',
      ])
    })

    it('does not throw on a search that is an invalid regex on its own', async () => {
      await expect(
        service.listContacts(user, { search: '[unclosed' }),
      ).resolves.toBeDefined()
    })

    it('filters by tag and consent', async () => {
      await service.listContacts(user, { tag: 'vip', consent: 'sms' })
      expect(mockContactModel.find.mock.calls[0][0]).toEqual({
        user: user._id,
        tags: 'vip',
        smsConsent: true,
      })

      await service.listContacts(user, { consent: 'none' })
      expect(mockContactModel.find.mock.calls[1][0]).toEqual({
        user: user._id,
        smsConsent: { $ne: true },
        emailConsent: { $ne: true },
      })
    })

    it('ignores an unknown consent value', async () => {
      await service.listContacts(user, { consent: 'whatever' })
      expect(mockContactModel.find.mock.calls[0][0]).toEqual({ user: user._id })
    })
  })

  describe('countContacts', () => {
    it("counts only this user's contacts", async () => {
      mockContactModel.countDocuments.mockResolvedValue(7)
      await expect(service.countContacts(user)).resolves.toBe(7)
      expect(mockContactModel.countDocuments).toHaveBeenCalledWith({
        user: user._id,
      })
    })
  })

  describe('importContactsFromCsv', () => {
    const createdDocs = () =>
      mockContactModel.create.mock.calls.map((c) => c[0])

    it('creates contacts from flexible column names and files unknown columns as attributes', async () => {
      const csv = [
        'Full Name,Mobile,Email Address,Tags,Shop Name,Points',
        'Asha,+977 980 123 4567,Asha@Example.com,vip;ktm,Asha Store,12',
      ].join('\n')

      const summary = await service.importContactsFromCsv(csv, user)

      expect(summary).toEqual({
        created: 1,
        updated: 0,
        skipped: 0,
        skippedReasons: {},
      })
      expect(createdDocs()[0]).toMatchObject({
        user: user._id,
        name: 'Asha',
        phone: '+9779801234567',
        email: 'asha@example.com',
        tags: ['vip', 'ktm'],
        attributes: { shop_name: 'Asha Store', points: '12' },
        smsConsent: false,
        emailConsent: false,
      })
      expect(createdDocs()[0].consentAt).toBeUndefined()
    })

    it('combines first_name and last_name when there is no name column', async () => {
      const csv = 'first_name,last_name,phone\nAsha,Shrestha,+9779801234567'
      await service.importContactsFromCsv(csv, user)
      expect(createdDocs()[0].name).toBe('Asha Shrestha')
    })

    it('handles quoted fields with commas and newlines', async () => {
      const csv =
        'name,phone,note\r\n' +
        '"Shrestha, Asha",+9779801234567,"line one\r\nline two, with comma"\r\n' +
        '"Rai ""Raj"" Kumar",+9779801234568,plain\r\n'

      const summary = await service.importContactsFromCsv(csv, user)

      expect(summary.created).toBe(2)
      expect(summary.skipped).toBe(0)
      expect(createdDocs()[0].name).toBe('Shrestha, Asha')
      expect(createdDocs()[0].attributes.note).toBe(
        'line one\r\nline two, with comma',
      )
      expect(createdDocs()[1].name).toBe('Rai "Raj" Kumar')
    })

    it('still recognises the first column when the file starts with a BOM', async () => {
      const csv = '﻿phone,name\n+9779801234567,Asha\n'
      const summary = await service.importContactsFromCsv(csv, user)
      expect(summary.created).toBe(1)
      expect(createdDocs()[0].phone).toBe('+9779801234567')
      expect(createdDocs()[0].attributes).toEqual({})
    })

    it('skips duplicate rows within one file, matching on normalised phone or email', async () => {
      const csv = [
        'name,phone,email',
        'A,+9779801234567,',
        'A again,0980-123-4567,',
        'B,,b@example.com',
        'B again,,B@EXAMPLE.COM',
        'C,+9779801234569,c@example.com',
      ].join('\n')

      const summary = await service.importContactsFromCsv(csv, user, {
        defaultCountryCode: '977',
      })

      expect(summary.created).toBe(3)
      expect(summary.skipped).toBe(2)
      expect(summary.skippedReasons).toEqual({ duplicate_in_file: 2 })
    })

    it('skips a row whose phone cannot be normalised and carries on', async () => {
      const csv = [
        'name,phone',
        'Bad,not a number',
        'Good,+9779801234567',
        'Junk,++977',
      ].join('\n')

      const summary = await service.importContactsFromCsv(csv, user)

      expect(summary.created).toBe(1)
      expect(summary.skipped).toBe(2)
      expect(summary.skippedReasons).toEqual({ invalid_phone: 2 })
    })

    it('keeps a row whose phone is bad when its email is good', async () => {
      const csv = 'name,phone,email\nAsha,garbage,asha@example.com'
      const summary = await service.importContactsFromCsv(csv, user)
      expect(summary.created).toBe(1)
      expect(createdDocs()[0].phone).toBeUndefined()
      expect(createdDocs()[0].email).toBe('asha@example.com')
    })

    it('skips rows with neither a phone nor an email', async () => {
      const csv = 'name,phone,email\nGhost,,\n,,\nAsha,+9779801234567,'
      const summary = await service.importContactsFromCsv(csv, user)
      expect(summary.created).toBe(1)
      expect(summary.skippedReasons).toEqual({ no_phone_or_email: 1 })
    })

    it('rejects a file with no phone and no email column', async () => {
      const error = await service
        .importContactsFromCsv('name,city\nAsha,Kathmandu', user)
        .catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST)
      expect(mockContactModel.create).not.toHaveBeenCalled()
    })

    it('rejects an empty file', async () => {
      const error = await service
        .importContactsFromCsv('', user)
        .catch((e) => e)
      expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST)
    })

    it('returns zeros for a header-only file', async () => {
      const summary = await service.importContactsFromCsv('name,phone\n', user)
      expect(summary).toEqual({
        created: 0,
        updated: 0,
        skipped: 0,
        skippedReasons: {},
      })
      expect(mockContactModel.find).not.toHaveBeenCalled()
    })

    it('tolerates a row with fewer cells than the header', async () => {
      const csv = 'name,phone,email\nAsha,+9779801234567'
      const summary = await service.importContactsFromCsv(csv, user)
      expect(summary.created).toBe(1)
      expect(createdDocs()[0].email).toBeUndefined()
    })

    it('records no consent when the consent column is absent and no consentSource is given', async () => {
      const csv = 'name,phone,email\nAsha,+9779801234567,asha@example.com'
      await service.importContactsFromCsv(csv, user)
      const doc = createdDocs()[0]
      expect(doc.smsConsent).toBe(false)
      expect(doc.emailConsent).toBe(false)
      expect(doc.consentAt).toBeUndefined()
      expect(doc.consentSource).toBeUndefined()
    })

    it('records consent per channel when the consent column is truthy', async () => {
      const csv = [
        'name,phone,email,consent',
        'Both,+9779801234567,both@example.com,yes',
        'Phone only,+9779801234568,,TRUE',
        'Email only,,email@example.com,1',
        'Declined,+9779801234569,,no',
        'Blank,+9779801234560,,',
      ].join('\n')

      await service.importContactsFromCsv(csv, user)
      const [both, phoneOnly, emailOnly, declined, blank] = createdDocs()

      expect(both).toMatchObject({ smsConsent: true, emailConsent: true })
      expect(both.consentSource).toBe('csv')
      expect(both.consentAt).toBeInstanceOf(Date)

      expect(phoneOnly).toMatchObject({ smsConsent: true, emailConsent: false })
      expect(emailOnly).toMatchObject({ smsConsent: false, emailConsent: true })

      expect(declined).toMatchObject({ smsConsent: false, emailConsent: false })
      expect(declined.consentAt).toBeUndefined()

      expect(blank).toMatchObject({ smsConsent: false, emailConsent: false })
    })

    it('records consent for every row when consentSource is supplied, except an explicit no', async () => {
      const csv = [
        'name,phone,consent',
        'A,+9779801234567,',
        'B,+9779801234568,no',
      ].join('\n')

      await service.importContactsFromCsv(csv, user, {
        consentSource: 'csv:march-list',
      })
      const [a, b] = createdDocs()

      expect(a.smsConsent).toBe(true)
      expect(a.consentSource).toBe('csv:march-list')
      expect(a.consentAt).toBeInstanceOf(Date)

      expect(b.smsConsent).toBe(false)
      expect(b.consentSource).toBeUndefined()
    })

    it('applies consentSource to a file with no consent column at all', async () => {
      const csv = 'name,phone\nA,+9779801234567'
      await service.importContactsFromCsv(csv, user, { consentSource: 'pos' })
      expect(createdDocs()[0]).toMatchObject({
        smsConsent: true,
        consentSource: 'pos',
      })
    })

    it('skips local-form numbers without a defaultCountryCode and accepts them with one', async () => {
      const csv = 'name,phone\nA,09801234567\nB,9801234568\nC,+9779801234569'

      const without = await service.importContactsFromCsv(csv, user)
      expect(without.created).toBe(1)
      expect(without.skippedReasons).toEqual({ invalid_phone: 2 })

      jest.clearAllMocks()
      mockContactModel.find.mockReturnValue(queryChain([]))

      const withCode = await service.importContactsFromCsv(csv, user, {
        defaultCountryCode: '977',
      })
      expect(withCode.created).toBe(3)
      expect(createdDocs().map((d) => d.phone)).toEqual([
        '+9779801234567',
        '+9779801234568',
        '+9779801234569',
      ])
    })

    it('applies file-level tags to every row and merges them with row tags', async () => {
      const csv = 'phone,tags\n+9779801234567,vip\n+9779801234568,'
      await service.importContactsFromCsv(csv, user, {
        tags: ['march-import', ' march-import '],
      })
      expect(createdDocs()[0].tags).toEqual(['march-import', 'vip'])
      expect(createdDocs()[1].tags).toEqual(['march-import'])
    })

    it('updates existing contacts instead of creating duplicates', async () => {
      const existingId = new Types.ObjectId()
      mockContactModel.find.mockReturnValue(
        queryChain([
          { _id: existingId, phone: '+9779801234567', email: undefined },
        ]),
      )
      const csv = [
        'name,phone,email,tags,shop',
        'Asha Updated,0980 123 4567,asha@example.com,vip,New Shop',
        'Fresh,+9779801234568,,,',
      ].join('\n')

      const summary = await service.importContactsFromCsv(csv, user, {
        defaultCountryCode: '977',
        consentSource: 'csv:march',
      })

      expect(summary).toMatchObject({ created: 1, updated: 1, skipped: 0 })

      // Looked up both phones and the email in one query, scoped to the user.
      const lookup = mockContactModel.find.mock.calls[0][0]
      expect(lookup.user).toBe(user._id)
      expect(lookup.$or).toEqual([
        { phone: { $in: ['+9779801234567', '+9779801234568'] } },
        { email: { $in: ['asha@example.com'] } },
      ])

      expect(mockContactModel.updateOne).toHaveBeenCalledTimes(1)
      const [filter, update] = mockContactModel.updateOne.mock.calls[0]
      expect(filter).toEqual({ _id: existingId, user: user._id })
      expect(update.$set).toMatchObject({
        name: 'Asha Updated',
        email: 'asha@example.com',
        'attributes.shop': 'New Shop',
        smsConsent: true,
        emailConsent: true,
        consentSource: 'csv:march',
      })
      expect(update.$set.phone).toBeUndefined()
      expect(update.$set.consentAt).toBeInstanceOf(Date)
      expect(update.$addToSet).toEqual({ tags: { $each: ['vip'] } })

      expect(mockContactModel.create).toHaveBeenCalledTimes(1)
      expect(createdDocs()[0].phone).toBe('+9779801234568')
    })

    it('does not revoke existing consent or blank the name when re-importing without consent', async () => {
      mockContactModel.find.mockReturnValue(
        queryChain([{ _id: new Types.ObjectId(), phone: '+9779801234567' }]),
      )
      await service.importContactsFromCsv(
        'name,phone,city\n,+9779801234567,Kathmandu',
        user,
      )

      const [, update] = mockContactModel.updateOne.mock.calls[0]
      expect(update.$set).toEqual({ 'attributes.city': 'Kathmandu' })
      expect(update.$addToSet).toBeUndefined()
    })

    it('does not write at all when a re-imported row adds nothing new', async () => {
      const existingId = new Types.ObjectId()
      mockContactModel.find.mockReturnValue(
        queryChain([{ _id: existingId, phone: '+9779801234567' }]),
      )
      const summary = await service.importContactsFromCsv(
        'phone\n+9779801234567',
        user,
      )
      expect(summary.updated).toBe(1)
      expect(mockContactModel.updateOne).not.toHaveBeenCalled()
    })

    it('skips a row that would stitch two different existing contacts together', async () => {
      mockContactModel.find.mockReturnValue(
        queryChain([
          { _id: new Types.ObjectId(), phone: '+9779801234567' },
          { _id: new Types.ObjectId(), email: 'asha@example.com' },
        ]),
      )
      const summary = await service.importContactsFromCsv(
        'phone,email\n+9779801234567,asha@example.com',
        user,
      )
      expect(summary).toEqual({
        created: 0,
        updated: 0,
        skipped: 1,
        skippedReasons: { conflicts_with_existing: 1 },
      })
      expect(mockContactModel.updateOne).not.toHaveBeenCalled()
      expect(mockContactModel.create).not.toHaveBeenCalled()
    })

    it('counts a failed write for one row and keeps importing the rest', async () => {
      mockContactModel.create
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce({ code: 11000 })
        .mockResolvedValue({})

      const csv = [
        'phone',
        '+9779801234561',
        '+9779801234562',
        '+9779801234563',
      ].join('\n')

      const summary = await service.importContactsFromCsv(csv, user)

      expect(summary).toEqual({
        created: 1,
        updated: 0,
        skipped: 2,
        skippedReasons: { write_failed: 1, conflicts_with_existing: 1 },
      })
    })

    it("never leaks another user's contacts into the dedupe lookup", async () => {
      await service.importContactsFromCsv('phone\n+9779801234567', user)
      const lookup = mockContactModel.find.mock.calls[0][0]
      expect(lookup.user).toBe(user._id)
      expect(lookup.user).not.toBe(otherUserId)
    })
  })

  describe('escapeRegExp', () => {
    it('escapes every metacharacter', () => {
      const raw = '.*+?^${}()|[]\\'
      expect(new RegExp(escapeRegExp(raw)).test(raw)).toBe(true)
      expect(new RegExp(`^${escapeRegExp(raw)}$`).test('anything')).toBe(false)
    })
  })
})
