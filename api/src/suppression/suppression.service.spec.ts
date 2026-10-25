import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { HttpException } from '@nestjs/common'
import { Types } from 'mongoose'
import {
  OPT_IN_CONFIRMATION_REPLY,
  OPT_OUT_CONFIRMATION_REPLY,
  SuppressionService,
} from './suppression.service'
import { Suppression } from './schemas/suppression.schema'
import { Contact } from '../contacts/schemas/contact.schema'
import { Channel, SuppressionReason } from '../sendline/sendline.enums'

/** Mimics a mongoose Query: awaitable directly or via .lean(). */
function query<T>(result: T) {
  const q: any = Promise.resolve(result)
  q.lean = () => Promise.resolve(result)
  return q
}

describe('SuppressionService', () => {
  let service: SuppressionService

  const user = { _id: new Types.ObjectId() }

  const mockSuppressionModel = {
    findOne: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
    deleteMany: jest.fn(),
    countDocuments: jest.fn(),
  }

  const mockContactModel = {
    updateMany: jest.fn(),
  }

  const originalCountryCode = process.env.DEFAULT_PHONE_COUNTRY_CODE

  beforeEach(async () => {
    delete process.env.DEFAULT_PHONE_COUNTRY_CODE

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppressionService,
        {
          provide: getModelToken(Suppression.name),
          useValue: mockSuppressionModel,
        },
        { provide: getModelToken(Contact.name), useValue: mockContactModel },
      ],
    }).compile()

    service = module.get<SuppressionService>(SuppressionService)

    jest.clearAllMocks()
    mockContactModel.updateMany.mockResolvedValue({ modifiedCount: 0 })
    mockSuppressionModel.findOneAndUpdate.mockImplementation((filter, update) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...filter, ...update.$set }),
    )
  })

  afterAll(() => {
    if (originalCountryCode === undefined) {
      delete process.env.DEFAULT_PHONE_COUNTRY_CODE
    } else {
      process.env.DEFAULT_PHONE_COUNTRY_CODE = originalCountryCode
    }
  })

  // ---------------------------------------------------------------------------

  describe('suppress', () => {
    it('normalises the value and upserts on (user, channel, value)', async () => {
      await service.suppress(
        '+977 984-123-4567',
        Channel.SMS,
        user,
        SuppressionReason.MANUAL,
      )

      expect(mockSuppressionModel.findOneAndUpdate).toHaveBeenCalledTimes(1)
      const [filter, update, options] =
        mockSuppressionModel.findOneAndUpdate.mock.calls[0]
      expect(filter).toEqual({
        user: user._id,
        channel: Channel.SMS,
        value: '+9779841234567',
      })
      expect(update.$setOnInsert.value).toBe('+9779841234567')
      expect(update.$set.reason).toBe(SuppressionReason.MANUAL)
      expect(options).toMatchObject({ upsert: true, new: true })
    })

    it('is idempotent: suppressing the same value twice issues identical upserts and never inserts twice', async () => {
      await service.suppress('ASHA@Example.com', Channel.EMAIL, user)
      await service.suppress('asha@example.com ', Channel.EMAIL, user)

      expect(mockSuppressionModel.findOneAndUpdate).toHaveBeenCalledTimes(2)
      const [first] = mockSuppressionModel.findOneAndUpdate.mock.calls[0]
      const [second] = mockSuppressionModel.findOneAndUpdate.mock.calls[1]
      expect(first).toEqual(second)
      expect(first.value).toBe('asha@example.com')
      // Both calls were upserts, so the unique index can never be violated
      // by this path.
      for (const call of mockSuppressionModel.findOneAndUpdate.mock.calls) {
        expect(call[2].upsert).toBe(true)
      }
    })

    it('survives a duplicate-key race by reading back the winner', async () => {
      const existing = { _id: new Types.ObjectId(), value: '+9779841234567' }
      mockSuppressionModel.findOneAndUpdate.mockRejectedValueOnce({
        code: 11000,
      })
      mockSuppressionModel.findOne.mockResolvedValueOnce(existing)

      const row = await service.suppress('+9779841234567', Channel.SMS, user)

      expect(row).toBe(existing)
      expect(mockSuppressionModel.findOne).toHaveBeenCalledWith({
        user: user._id,
        channel: Channel.SMS,
        value: '+9779841234567',
      })
    })

    it('rethrows errors that are not duplicate-key', async () => {
      mockSuppressionModel.findOneAndUpdate.mockRejectedValueOnce(
        new Error('connection lost'),
      )
      await expect(
        service.suppress('+9779841234567', Channel.SMS, user),
      ).rejects.toThrow('connection lost')
    })

    it('marks matching contacts opted out and clears the channel consent flag', async () => {
      await service.suppress('+9779841234567', Channel.SMS, user)

      expect(mockContactModel.updateMany).toHaveBeenCalledTimes(1)
      const [filter, update] = mockContactModel.updateMany.mock.calls[0]
      expect(filter).toEqual({ user: user._id, phone: '+9779841234567' })
      expect(update.$set.smsConsent).toBe(false)
      expect(update.$set.optedOutAt).toBeInstanceOf(Date)
      expect(update.$set).not.toHaveProperty('emailConsent')
    })

    it('uses the email field and emailConsent for the email channel', async () => {
      await service.suppress('Bob@Example.COM', Channel.EMAIL, user)

      const [filter, update] = mockContactModel.updateMany.mock.calls[0]
      expect(filter).toEqual({ user: user._id, email: 'bob@example.com' })
      expect(update.$set.emailConsent).toBe(false)
      expect(update.$set).not.toHaveProperty('smsConsent')
    })

    it('rejects a value that cannot be normalised with a 400 and writes nothing', async () => {
      await expect(
        service.suppress('not a phone', Channel.SMS, user),
      ).rejects.toThrow(HttpException)
      await expect(
        service.suppress('9841234567', Channel.SMS, user), // local, no country code
      ).rejects.toThrow(HttpException)
      await expect(
        service.suppress('not-an-email', Channel.EMAIL, user),
      ).rejects.toThrow(HttpException)

      expect(mockSuppressionModel.findOneAndUpdate).not.toHaveBeenCalled()
      expect(mockContactModel.updateMany).not.toHaveBeenCalled()
    })

    it('applies DEFAULT_PHONE_COUNTRY_CODE to local-format numbers', async () => {
      process.env.DEFAULT_PHONE_COUNTRY_CODE = '+977'
      await service.suppress('09841234567', Channel.SMS, user)
      const [filter] = mockSuppressionModel.findOneAndUpdate.mock.calls[0]
      expect(filter.value).toBe('+9779841234567')
    })

    it('rejects an unknown channel', async () => {
      await expect(
        service.suppress('+9779841234567', 'fax' as Channel, user),
      ).rejects.toThrow(HttpException)
    })

    it('rejects an unknown reason', async () => {
      await expect(
        service.suppress(
          '+9779841234567',
          Channel.SMS,
          user,
          'because' as SuppressionReason,
        ),
      ).rejects.toThrow(HttpException)
    })

    it('stores evidence when given and leaves it alone when not', async () => {
      await service.suppress(
        '+9779841234567',
        Channel.SMS,
        user,
        SuppressionReason.STOP,
        'STOP',
      )
      expect(
        mockSuppressionModel.findOneAndUpdate.mock.calls[0][1].$set.evidence,
      ).toBe('STOP')

      await service.suppress(
        '+9779841234567',
        Channel.SMS,
        user,
        SuppressionReason.MANUAL,
      )
      expect(
        mockSuppressionModel.findOneAndUpdate.mock.calls[1][1].$set,
      ).not.toHaveProperty('evidence')
    })
  })

  // ---------------------------------------------------------------------------

  describe('isSuppressed', () => {
    it('returns true when a row exists for the normalised value', async () => {
      mockSuppressionModel.findOne.mockReturnValue(query({ _id: 'x' }))
      await expect(
        service.isSuppressed('+977 9841234567', Channel.SMS, user),
      ).resolves.toBe(true)

      const [filter] = mockSuppressionModel.findOne.mock.calls[0]
      expect(filter.user).toBe(user._id)
      expect(filter.channel).toBe(Channel.SMS)
      expect(filter.value.$in).toContain('+9779841234567')
    })

    it('returns false when no row exists', async () => {
      mockSuppressionModel.findOne.mockReturnValue(query(null))
      await expect(
        service.isSuppressed('+9779841234567', Channel.SMS, user),
      ).resolves.toBe(false)
    })

    it('also looks up the raw trimmed form so un-normalisable entries are still found', async () => {
      mockSuppressionModel.findOne.mockReturnValue(query(null))
      await service.isSuppressed('SHOPNAME', Channel.SMS, user)
      const [filter] = mockSuppressionModel.findOne.mock.calls[0]
      expect(filter.value.$in).toEqual(['SHOPNAME'])
    })

    it('fails closed for an empty value without querying', async () => {
      await expect(service.isSuppressed('', Channel.SMS, user)).resolves.toBe(
        true,
      )
      await expect(
        service.isSuppressed(undefined as any, Channel.SMS, user),
      ).resolves.toBe(true)
      expect(mockSuppressionModel.findOne).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------

  describe('filterSuppressed', () => {
    it('issues exactly one query for hundreds of values', async () => {
      const values = Array.from(
        { length: 300 },
        (_, i) => `+97798${String(10000000 + i).padStart(8, '0')}`,
      )
      mockSuppressionModel.find.mockReturnValue(
        query([{ value: values[3] }, { value: values[250] }]),
      )

      const suppressed = await service.filterSuppressed(
        values,
        Channel.SMS,
        user,
      )

      expect(mockSuppressionModel.find).toHaveBeenCalledTimes(1)
      expect(mockSuppressionModel.findOne).not.toHaveBeenCalled()
      const [filter] = mockSuppressionModel.find.mock.calls[0]
      expect(filter.user).toBe(user._id)
      expect(filter.channel).toBe(Channel.SMS)
      expect(filter.value.$in).toHaveLength(300)
      expect(suppressed).toEqual(new Set([values[3], values[250]]))
    })

    it('returns the subset spelled as the caller passed it, matched via normalisation', async () => {
      mockSuppressionModel.find.mockReturnValue(
        query([{ value: 'asha@example.com' }]),
      )

      const suppressed = await service.filterSuppressed(
        ['  ASHA@Example.com', 'bob@example.com'],
        Channel.EMAIL,
        user,
      )

      expect(suppressed).toEqual(new Set(['  ASHA@Example.com']))
    })

    it('treats two spellings of the same address as both suppressed', async () => {
      mockSuppressionModel.find.mockReturnValue(
        query([{ value: '+9779841234567' }]),
      )
      const suppressed = await service.filterSuppressed(
        ['+9779841234567', '+977 984 123 4567'],
        Channel.SMS,
        user,
      )
      expect(suppressed).toEqual(
        new Set(['+9779841234567', '+977 984 123 4567']),
      )
    })

    it('fails closed on unusable values and does not query for an empty list', async () => {
      const suppressed = await service.filterSuppressed(
        ['', '   '],
        Channel.SMS,
        user,
      )
      expect(suppressed).toEqual(new Set(['', '   ']))
      expect(mockSuppressionModel.find).not.toHaveBeenCalled()

      const empty = await service.filterSuppressed([], Channel.SMS, user)
      expect(empty.size).toBe(0)
      expect(mockSuppressionModel.find).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------

  describe('unsuppress', () => {
    it('deletes by every lookup key and does not touch contact consent', async () => {
      mockSuppressionModel.deleteMany.mockResolvedValue({ deletedCount: 1 })

      const result = await service.unsuppress(
        '+977 9841234567',
        Channel.SMS,
        user,
      )

      expect(result).toEqual({ deleted: true })
      const [filter] = mockSuppressionModel.deleteMany.mock.calls[0]
      expect(filter.user).toBe(user._id)
      expect(filter.value.$in).toContain('+9779841234567')
      expect(mockContactModel.updateMany).not.toHaveBeenCalled()
    })

    it('reports deleted: false when nothing matched', async () => {
      mockSuppressionModel.deleteMany.mockResolvedValue({ deletedCount: 0 })
      await expect(
        service.unsuppress('+9779841234567', Channel.SMS, user),
      ).resolves.toEqual({ deleted: false })
    })
  })

  describe('removeSuppressionById', () => {
    it('scopes the delete to the owner', async () => {
      const id = new Types.ObjectId().toHexString()
      mockSuppressionModel.findOneAndDelete.mockResolvedValue({ _id: id })

      await service.removeSuppressionById(id, user)

      expect(mockSuppressionModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: id,
        user: user._id,
      })
    })

    it('404s on a missing or malformed id', async () => {
      mockSuppressionModel.findOneAndDelete.mockResolvedValue(null)
      await expect(
        service.removeSuppressionById(new Types.ObjectId().toHexString(), user),
      ).rejects.toThrow(HttpException)
      await expect(service.removeSuppressionById('nope', user)).rejects.toThrow(
        HttpException,
      )
    })
  })

  // ---------------------------------------------------------------------------

  describe('listSuppressions', () => {
    it('paginates and filters by channel', async () => {
      mockSuppressionModel.countDocuments.mockResolvedValue(120)
      mockSuppressionModel.find.mockReturnValue(query([{ value: 'a' }]))

      const result = await service.listSuppressions(user, {
        channel: Channel.EMAIL,
        page: 3,
        limit: 50,
      })

      expect(mockSuppressionModel.countDocuments).toHaveBeenCalledWith({
        user: user._id,
        channel: Channel.EMAIL,
      })
      const [filter, , options] = mockSuppressionModel.find.mock.calls[0]
      expect(filter).toEqual({ user: user._id, channel: Channel.EMAIL })
      expect(options).toMatchObject({ skip: 100, limit: 50 })
      expect(result.meta).toEqual({
        page: 3,
        limit: 50,
        total: 120,
        totalPages: 3,
      })
      expect(result.data).toEqual([{ value: 'a' }])
    })

    it('clamps limit and page to sane bounds', async () => {
      mockSuppressionModel.countDocuments.mockResolvedValue(0)
      mockSuppressionModel.find.mockReturnValue(query([]))

      const result = await service.listSuppressions(user, {
        page: -4,
        limit: 10000,
      })

      expect(result.meta.page).toBe(1)
      expect(result.meta.limit).toBe(200)
    })
  })

  // ---------------------------------------------------------------------------

  describe('handleInboundMessage', () => {
    it('suppresses on STOP with reason STOP and the raw message as evidence', async () => {
      const outcome = await service.handleInboundMessage(
        { sender: '+977 9841234567', message: '  Stop.  ', deviceId: 'd1' },
        user,
      )

      expect(outcome.action).toBe('suppressed')
      expect(outcome.confirmationReply).toBe(OPT_OUT_CONFIRMATION_REPLY)
      expect(outcome.normalizedSender).toBe('+9779841234567')

      const [filter, update] =
        mockSuppressionModel.findOneAndUpdate.mock.calls[0]
      expect(filter.value).toBe('+9779841234567')
      expect(update.$set.reason).toBe(SuppressionReason.STOP)
      expect(update.$set.evidence).toBe('  Stop.  ')

      expect(mockContactModel.updateMany).toHaveBeenCalledWith(
        { user: user._id, phone: '+9779841234567' },
        expect.objectContaining({
          $set: expect.objectContaining({ smsConsent: false }),
        }),
      )
    })

    it('still records a STOP from a sender that cannot be normalised, under the raw sender', async () => {
      const outcome = await service.handleInboundMessage(
        { sender: 'SHOPNAME', message: 'STOP' },
        user,
      )

      expect(outcome.action).toBe('suppressed')
      expect(outcome.normalizedSender).toBeUndefined()
      const [filter, update] =
        mockSuppressionModel.findOneAndUpdate.mock.calls[0]
      expect(filter).toEqual({
        user: user._id,
        channel: Channel.SMS,
        value: 'SHOPNAME',
      })
      expect(update.$set.reason).toBe(SuppressionReason.STOP)
    })

    it('does not crash on a missing sender; routes to inbox flagged', async () => {
      const outcome = await service.handleInboundMessage(
        { sender: '', message: 'STOP' },
        user,
      )
      expect(outcome).toEqual({ action: 'inbox', flaggedForReview: true })
      expect(mockSuppressionModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('routes an ordinary reply to the inbox without touching the list', async () => {
      const outcome = await service.handleInboundMessage(
        { sender: '+9779841234567', message: 'stop by the shop tomorrow' },
        user,
      )

      expect(outcome.action).toBe('inbox')
      expect(outcome.confirmationReply).toBeUndefined()
      expect(mockSuppressionModel.findOneAndUpdate).not.toHaveBeenCalled()
      expect(mockSuppressionModel.deleteMany).not.toHaveBeenCalled()
      expect(mockContactModel.updateMany).not.toHaveBeenCalled()
    })

    it('flags natural-language opt-outs for human review instead of auto-suppressing', async () => {
      const outcome = await service.handleInboundMessage(
        { sender: '+9779841234567', message: 'I want to stop receiving these' },
        user,
      )
      expect(outcome.action).toBe('inbox')
      expect(outcome.flaggedForReview).toBe(true)
      expect(mockSuppressionModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('does not flag a plain reply', async () => {
      const outcome = await service.handleInboundMessage(
        { sender: '+9779841234567', message: 'see you at 5' },
        user,
      )
      expect(outcome.flaggedForReview).toBeUndefined()
    })

    it('on START removes the suppression and re-grants SMS consent', async () => {
      mockSuppressionModel.deleteMany.mockResolvedValue({ deletedCount: 1 })

      const outcome = await service.handleInboundMessage(
        { sender: '+9779841234567', message: 'START' },
        user,
      )

      expect(outcome.action).toBe('resubscribed')
      expect(outcome.confirmationReply).toBe(OPT_IN_CONFIRMATION_REPLY)
      expect(mockSuppressionModel.deleteMany).toHaveBeenCalledTimes(1)
      expect(
        mockSuppressionModel.deleteMany.mock.calls[0][0].value.$in,
      ).toContain('+9779841234567')

      const [filter, update] = mockContactModel.updateMany.mock.calls[0]
      expect(filter).toEqual({ user: user._id, phone: '+9779841234567' })
      expect(update.$set.smsConsent).toBe(true)
      expect(update.$set.consentAt).toBeInstanceOf(Date)
      expect(update.$set.consentSource).toBe('sms:start')
      expect(update.$unset).toEqual({ optedOutAt: 1 })
    })

    it('on START from an un-normalisable sender removes the raw entry but cannot re-consent a contact', async () => {
      mockSuppressionModel.deleteMany.mockResolvedValue({ deletedCount: 1 })

      const outcome = await service.handleInboundMessage(
        { sender: 'SHOPNAME', message: 'unstop' },
        user,
      )

      expect(outcome.action).toBe('resubscribed')
      expect(mockSuppressionModel.deleteMany).toHaveBeenCalledTimes(1)
      expect(mockContactModel.updateMany).not.toHaveBeenCalled()
    })

    it('a STOP wins over a START when both words appear (neither matches, inbox)', async () => {
      const outcome = await service.handleInboundMessage(
        { sender: '+9779841234567', message: 'STOP START' },
        user,
      )
      expect(outcome.action).toBe('inbox')
      expect(outcome.flaggedForReview).toBe(true)
    })

    it('tolerates a missing message body', async () => {
      const outcome = await service.handleInboundMessage(
        { sender: '+9779841234567', message: undefined as any },
        user,
      )
      expect(outcome.action).toBe('inbox')
    })
  })
})
