import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { getQueueToken } from '@nestjs/bull'
import { HttpException, HttpStatus } from '@nestjs/common'
import { Types } from 'mongoose'
import { CampaignsService } from './campaigns.service'
import { Campaign } from './schemas/campaign.schema'
import { Send } from './schemas/send.schema'
import { Contact } from '../contacts/schemas/contact.schema'
import { MessageTemplate } from '../templates/schemas/template.schema'
import { ListsService } from '../lists/lists.service'
import { SuppressionService } from '../suppression/suppression.service'
import { SENDLINE_SENDS_QUEUE } from './send-queue.constants'
import {
  CampaignStatus,
  Channel,
  DEFAULT_PACING,
  SendLane,
  SendStatus,
  SkipReason,
  SMS_OPT_OUT_NOTICE,
} from '../sendline/sendline.enums'

/** A Mongoose query chain whose terminal `exec()` resolves to `result`. */
const chain = (result: any) => {
  const q: any = {}
  for (const m of ['sort', 'limit', 'skip', 'populate', 'lean', 'select']) {
    q[m] = jest.fn().mockReturnValue(q)
  }
  q.exec = jest.fn().mockResolvedValue(result)
  return q
}

describe('CampaignsService', () => {
  let service: CampaignsService

  const user = { _id: new Types.ObjectId(), username: 'owner' } as any
  const otherUser = { _id: new Types.ObjectId(), username: 'other' } as any

  const mockCampaignModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  }
  const mockSendModel = {
    insertMany: jest.fn(),
    distinct: jest.fn(),
    aggregate: jest.fn(),
    find: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    countDocuments: jest.fn(),
  }
  const mockContactModel = { find: jest.fn() }
  const mockTemplateModel = { findOne: jest.fn() }
  const mockQueue = {
    add: jest.fn(),
    addBulk: jest.fn(),
    getJobs: jest.fn(),
  }
  const mockListsService = { resolveListMemberIds: jest.fn() }
  const mockSuppressionService = {
    filterSuppressed: jest.fn(),
    isSuppressed: jest.fn(),
  }

  const templateId = new Types.ObjectId()
  const listId = new Types.ObjectId()
  const deviceId = new Types.ObjectId()

  const makeCampaign = (overrides: Partial<Campaign> = {}): any => ({
    _id: new Types.ObjectId(),
    user: user._id,
    name: 'Dashain sale',
    channel: Channel.SMS,
    template: templateId,
    list: listId,
    device: deviceId,
    status: CampaignStatus.DRAFT,
    pacing: { ...DEFAULT_PACING },
    stats: {},
    ...overrides,
  })

  const smsTemplate = {
    _id: templateId,
    user: user._id,
    channel: Channel.SMS,
    body: 'Hi {{name}}, {{shop_name}} has 20% off this week',
  }

  const contact = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    user: user._id,
    name: 'Asha',
    phone: '+9779800000001',
    email: 'asha@example.com',
    attributes: { shop_name: 'Asha Store' },
    smsConsent: true,
    emailConsent: true,
    ...overrides,
  })

  /** Wires the mocks so getCampaignById resolves `campaign` for `user`. */
  const givenCampaign = (campaign: any) => {
    mockCampaignModel.findOne.mockImplementation((filter: any) =>
      chain(
        String(filter._id) === String(campaign._id) &&
          String(filter.user) === String(campaign.user)
          ? campaign
          : null,
      ),
    )
  }

  const givenAudience = (
    contacts: any[],
    options: { suppressed?: string[]; alreadySent?: string[] } = {},
  ) => {
    mockListsService.resolveListMemberIds.mockResolvedValue(
      contacts.map((c) => c._id),
    )
    mockContactModel.find.mockReturnValue(chain(contacts))
    mockSuppressionService.filterSuppressed.mockResolvedValue(
      new Set(options.suppressed ?? []),
    )
    mockSendModel.distinct.mockResolvedValue(options.alreadySent ?? [])
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: getModelToken(Campaign.name), useValue: mockCampaignModel },
        { provide: getModelToken(Send.name), useValue: mockSendModel },
        { provide: getModelToken(Contact.name), useValue: mockContactModel },
        {
          provide: getModelToken(MessageTemplate.name),
          useValue: mockTemplateModel,
        },
        { provide: getQueueToken(SENDLINE_SENDS_QUEUE), useValue: mockQueue },
        { provide: ListsService, useValue: mockListsService },
        { provide: SuppressionService, useValue: mockSuppressionService },
      ],
    }).compile()

    service = module.get<CampaignsService>(CampaignsService)

    jest.clearAllMocks()
    mockCampaignModel.updateOne.mockReturnValue(chain({ modifiedCount: 1 }))
    mockSendModel.updateMany.mockReturnValue(chain({ modifiedCount: 0 }))
    mockSendModel.aggregate.mockResolvedValue([])
    mockSendModel.insertMany.mockImplementation(async (rows: any[]) =>
      rows.map((row) => ({ ...row, _id: new Types.ObjectId() })),
    )
    mockTemplateModel.findOne.mockReturnValue(chain(smsTemplate))
    mockQueue.addBulk.mockResolvedValue([])
    mockQueue.add.mockResolvedValue({})
    mockQueue.getJobs.mockResolvedValue([])
  })

  describe('getCampaignById', () => {
    it('throws 404 for an unknown or malformed id', async () => {
      mockCampaignModel.findOne.mockReturnValue(chain(null))
      await expect(
        service.getCampaignById(new Types.ObjectId().toString(), user),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND })
      await expect(service.getCampaignById('nope', user)).rejects.toThrow(
        HttpException,
      )
      expect(mockCampaignModel.findOne).toHaveBeenCalledTimes(1)
    })

    it('scopes the lookup to the requesting user', async () => {
      const campaign = makeCampaign()
      givenCampaign(campaign)
      await expect(
        service.getCampaignById(campaign._id.toString(), otherUser),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND })
      await expect(
        service.getCampaignById(campaign._id.toString(), user),
      ).resolves.toBe(campaign)
    })
  })

  describe('createCampaign', () => {
    it('refuses an SMS campaign without a device', async () => {
      await expect(
        service.createCampaign(
          {
            name: 'x',
            channel: Channel.SMS,
            template: templateId.toString(),
            list: listId.toString(),
          },
          user,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST })
      expect(mockCampaignModel.create).not.toHaveBeenCalled()
    })

    it('creates a draft owned by the user with pacing merged over defaults', async () => {
      mockCampaignModel.create.mockImplementation(async (doc) => doc)
      const created = await service.createCampaign(
        {
          name: 'Newsletter',
          channel: Channel.EMAIL,
          template: templateId.toString(),
          list: listId.toString(),
          pacing: { ratePerMinute: 30, timezone: 'Asia/Kathmandu' },
        },
        user,
      )
      expect(created).toMatchObject({
        user: user._id,
        status: CampaignStatus.DRAFT,
        channel: Channel.EMAIL,
        pacing: {
          ...DEFAULT_PACING,
          ratePerMinute: 30,
          timezone: 'Asia/Kathmandu',
        },
      })
      expect(created.template).toBeInstanceOf(Types.ObjectId)
      expect(created.device).toBeUndefined()
    })
  })

  describe('updateCampaign', () => {
    it('refuses edits to a completed campaign', async () => {
      const campaign = makeCampaign({ status: CampaignStatus.COMPLETED })
      givenCampaign(campaign)
      await expect(
        service.updateCampaign(campaign._id.toString(), { name: 'x' }, user),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT })
    })

    it('allows only name, pacing and schedule while paused', async () => {
      const campaign = makeCampaign({ status: CampaignStatus.PAUSED })
      givenCampaign(campaign)
      await expect(
        service.updateCampaign(
          campaign._id.toString(),
          { list: new Types.ObjectId().toString() },
          user,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT })

      mockCampaignModel.findOneAndUpdate.mockReturnValue(chain(campaign))
      await service.updateCampaign(
        campaign._id.toString(),
        { pacing: { ratePerMinute: 2 } },
        user,
      )
      expect(mockCampaignModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: campaign._id, user: user._id },
        { $set: { pacing: { ...DEFAULT_PACING, ratePerMinute: 2 } } },
        { new: true },
      )
    })
  })

  describe('deleteCampaign', () => {
    it('refuses while sending and otherwise removes the campaign and its sends', async () => {
      const sending = makeCampaign({ status: CampaignStatus.SENDING })
      givenCampaign(sending)
      await expect(
        service.deleteCampaign(sending._id.toString(), user),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT })

      const draft = makeCampaign()
      givenCampaign(draft)
      mockSendModel.deleteMany.mockResolvedValue({ deletedCount: 3 })
      mockCampaignModel.deleteOne.mockResolvedValue({ deletedCount: 1 })
      await service.deleteCampaign(draft._id.toString(), user)
      expect(mockSendModel.deleteMany).toHaveBeenCalledWith({
        campaign: draft._id,
        user: user._id,
      })
      expect(mockCampaignModel.deleteOne).toHaveBeenCalledWith({
        _id: draft._id,
        user: user._id,
      })
    })
  })

  describe('startCampaign', () => {
    it('refuses to start a campaign that is not a draft', async () => {
      const campaign = makeCampaign({ status: CampaignStatus.SENDING })
      givenCampaign(campaign)
      await expect(
        service.startCampaign(campaign._id.toString(), user),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT })
      expect(mockSendModel.insertMany).not.toHaveBeenCalled()
    })

    it('refuses an SMS campaign with no device', async () => {
      const campaign = makeCampaign({ device: undefined })
      givenCampaign(campaign)
      await expect(
        service.startCampaign(campaign._id.toString(), user),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST })
    })

    it('refuses when the template channel does not match', async () => {
      const campaign = makeCampaign()
      givenCampaign(campaign)
      mockTemplateModel.findOne.mockReturnValue(
        chain({ ...smsTemplate, channel: Channel.EMAIL }),
      )
      await expect(
        service.startCampaign(campaign._id.toString(), user),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST })
    })

    it('404s when the template is missing or belongs to someone else', async () => {
      const campaign = makeCampaign()
      givenCampaign(campaign)
      mockTemplateModel.findOne.mockReturnValue(chain(null))
      await expect(
        service.startCampaign(campaign._id.toString(), user),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND })
      expect(mockTemplateModel.findOne).toHaveBeenCalledWith({
        _id: templateId,
        user: user._id,
      })
    })

    it('writes QUEUED rows with rendered bodies, SKIPPED rows with reasons, and enqueues one job per eligible', async () => {
      const campaign = makeCampaign()
      givenCampaign(campaign)
      const ok = contact({ name: 'Asha', phone: '+9779800000001' })
      const duplicate = contact({ name: 'Asha again', phone: '+9779800000001' })
      const suppressed = contact({ name: 'Bir', phone: '+9779800000002' })
      const noConsent = contact({
        name: 'Cham',
        phone: '+9779800000003',
        smsConsent: false,
      })
      const alreadySent = contact({ name: 'Dil', phone: '+9779800000004' })
      const noPhone = contact({ name: 'Eka', phone: undefined })
      givenAudience(
        [ok, duplicate, suppressed, noConsent, alreadySent, noPhone],
        {
          suppressed: ['+9779800000002'],
          alreadySent: ['+9779800000004'],
        },
      )
      const started = { ...campaign, status: CampaignStatus.SENDING }
      mockCampaignModel.findOne
        .mockReturnValueOnce(chain(campaign))
        .mockReturnValue(chain(started))

      const result = await service.startCampaign(campaign._id.toString(), user)

      // Contacts are loaded scoped to the user and the list's members.
      expect(mockContactModel.find).toHaveBeenCalledWith({
        _id: { $in: expect.any(Array) },
        user: user._id,
      })
      // Only usable numbers are sent to the suppression check.
      expect(mockSuppressionService.filterSuppressed).toHaveBeenCalledWith(
        [
          '+9779800000001',
          '+9779800000001',
          '+9779800000002',
          '+9779800000003',
          '+9779800000004',
        ],
        Channel.SMS,
        user,
      )

      expect(mockSendModel.insertMany).toHaveBeenCalledTimes(2)
      const [skippedRows] = mockSendModel.insertMany.mock.calls[0]
      const [queuedRows] = mockSendModel.insertMany.mock.calls[1]

      expect(skippedRows.map((r) => [r.contact, r.skipReason])).toEqual([
        [duplicate._id, SkipReason.DUPLICATE],
        [suppressed._id, SkipReason.SUPPRESSED],
        [noConsent._id, SkipReason.NO_CONSENT],
        [alreadySent._id, SkipReason.ALREADY_SENT],
        [noPhone._id, SkipReason.INVALID_ADDRESS],
      ])
      skippedRows.forEach((row) => {
        expect(row).toMatchObject({
          user: user._id,
          campaign: campaign._id,
          channel: Channel.SMS,
          lane: SendLane.MARKETING,
          status: SendStatus.SKIPPED,
        })
        expect(typeof row.recipient).toBe('string')
        expect(row.recipient.length).toBeGreaterThan(0)
      })

      expect(queuedRows).toHaveLength(1)
      expect(queuedRows[0]).toMatchObject({
        user: user._id,
        campaign: campaign._id,
        contact: ok._id,
        channel: Channel.SMS,
        lane: SendLane.MARKETING,
        recipient: '+9779800000001',
        status: SendStatus.QUEUED,
        renderedBody: `Hi Asha, Asha Store has 20% off this week ${SMS_OPT_OUT_NOTICE}`,
        attempts: 0,
      })
      expect(queuedRows[0].queuedAt).toBeInstanceOf(Date)

      expect(mockQueue.addBulk).toHaveBeenCalledTimes(1)
      const jobs = mockQueue.addBulk.mock.calls[0][0]
      expect(jobs).toHaveLength(1)
      expect(jobs[0].data).toEqual({
        sendId: expect.any(String),
        campaignId: campaign._id.toString(),
      })
      expect(jobs[0].opts.jobId).toBe(jobs[0].data.sendId)
      expect(jobs[0].opts.delay).toBeGreaterThanOrEqual(0)

      expect(mockCampaignModel.updateOne).toHaveBeenCalledWith(
        { _id: campaign._id },
        {
          $set: expect.objectContaining({
            status: CampaignStatus.SENDING,
            startedAt: expect.any(Date),
          }),
        },
      )
      // Stats are rebuilt from the Send rows.
      expect(mockSendModel.aggregate).toHaveBeenCalled()
      expect(result.status).toBe(CampaignStatus.SENDING)
    })

    it('does not append the opt-out notice when the template already says STOP', async () => {
      const campaign = makeCampaign()
      givenCampaign(campaign)
      mockTemplateModel.findOne.mockReturnValue(
        chain({ ...smsTemplate, body: 'Hi {{name}}. Text STOP to end.' }),
      )
      givenAudience([contact()])
      await service.startCampaign(campaign._id.toString(), user)
      const [queuedRows] = mockSendModel.insertMany.mock.calls[0]
      expect(queuedRows[0].renderedBody).toBe('Hi Asha. Text STOP to end.')
    })

    it('renders the email subject and never appends the SMS notice to email', async () => {
      const campaign = makeCampaign({
        channel: Channel.EMAIL,
        device: undefined,
      })
      givenCampaign(campaign)
      mockTemplateModel.findOne.mockReturnValue(
        chain({
          ...smsTemplate,
          channel: Channel.EMAIL,
          subject: 'Hello {{name}}',
          body: 'Welcome to {{shop_name}}',
        }),
      )
      givenAudience([contact({ email: 'Asha@Example.com' })])
      await service.startCampaign(campaign._id.toString(), user)
      const [queuedRows] = mockSendModel.insertMany.mock.calls[0]
      expect(queuedRows[0]).toMatchObject({
        channel: Channel.EMAIL,
        recipient: 'asha@example.com',
        subject: 'Hello Asha',
        renderedBody: 'Welcome to Asha Store',
      })
    })

    it('completes immediately when nobody is eligible', async () => {
      const campaign = makeCampaign()
      givenCampaign(campaign)
      givenAudience([contact({ smsConsent: false })])
      await service.startCampaign(campaign._id.toString(), user)

      expect(mockSendModel.insertMany).toHaveBeenCalledTimes(1)
      expect(mockQueue.addBulk).not.toHaveBeenCalled()
      expect(mockCampaignModel.updateOne).toHaveBeenCalledWith(
        { _id: campaign._id },
        {
          $set: expect.objectContaining({
            status: CampaignStatus.COMPLETED,
            completedAt: expect.any(Date),
          }),
        },
      )
    })

    it('spaces the jobs out according to the pacing rate', async () => {
      const campaign = makeCampaign({
        pacing: {
          ...DEFAULT_PACING,
          ratePerMinute: 60,
          windowStartHour: 0,
          windowEndHour: 0,
        },
      })
      givenCampaign(campaign)
      givenAudience([
        contact({ phone: '+9779800000001' }),
        contact({ phone: '+9779800000002' }),
        contact({ phone: '+9779800000003' }),
      ])
      await service.startCampaign(campaign._id.toString(), user)
      const jobs = mockQueue.addBulk.mock.calls[0][0]
      const delays = jobs.map((j) => j.opts.delay)
      expect(delays[0]).toBeLessThanOrEqual(DEFAULT_PACING.jitterMs)
      // Each slot is 1000ms apart, +/- 2000ms jitter.
      expect(delays[2]).toBeGreaterThanOrEqual(0)
      expect(delays[2]).toBeLessThanOrEqual(2000 + DEFAULT_PACING.jitterMs)
      delays.forEach((d) => expect(d).toBeGreaterThanOrEqual(0))
    })
  })

  describe('previewCampaign', () => {
    it('renders up to three samples and reports the true eligible count and skip breakdown', async () => {
      const campaign = makeCampaign({
        pacing: { ...DEFAULT_PACING, windowStartHour: 0, windowEndHour: 0 },
      })
      givenCampaign(campaign)
      const contacts = [
        contact({ name: 'A', phone: '+9779800000001' }),
        contact({ name: 'B', phone: '+9779800000002', attributes: {} }),
        contact({ name: 'C', phone: '+9779800000003' }),
        contact({ name: 'D', phone: '+9779800000004' }),
        contact({ name: 'E', phone: '+9779800000005', smsConsent: false }),
        contact({ name: 'F', phone: '+9779800000001' }),
      ]
      givenAudience(contacts, { suppressed: ['+9779800000003'] })

      const preview = await service.previewCampaign(
        campaign._id.toString(),
        user,
      )

      expect(preview.audienceSize).toBe(6)
      expect(preview.eligibleCount).toBe(3)
      expect(preview.skippedCount).toBe(3)
      expect(preview.skippedByReason).toEqual({
        [SkipReason.SUPPRESSED]: 1,
        [SkipReason.NO_CONSENT]: 1,
        [SkipReason.DUPLICATE]: 1,
        [SkipReason.INVALID_ADDRESS]: 0,
        [SkipReason.ALREADY_SENT]: 0,
      })
      expect(preview.samples).toHaveLength(3)
      expect(preview.samples[0]).toMatchObject({
        contactName: 'A',
        recipient: '+9779800000001',
        body: `Hi A, Asha Store has 20% off this week ${SMS_OPT_OUT_NOTICE}`,
        missingTags: [],
      })
      expect(preview.samples[0].segments).toEqual({
        encoding: 'GSM-7',
        characters: expect.any(Number),
        segments: 1,
      })
      expect(preview.samples[1].missingTags).toEqual(['shop_name'])
      expect(preview.segmentsPerMessage).toBe(1)
      expect(preview.totalSegments).toBe(3)
      // 3 messages at 10/min: two 6s gaps.
      expect(preview.estimatedDurationMs).toBe(12000)
      expect(preview.windowOpenNow).toBe(true)
      expect(preview.warnings).toEqual([expect.stringContaining('shop_name')])
      // Preview must not write anything or enqueue anything.
      expect(mockSendModel.insertMany).not.toHaveBeenCalled()
      expect(mockQueue.addBulk).not.toHaveBeenCalled()
      expect(mockCampaignModel.updateOne).not.toHaveBeenCalled()
    })

    it('warns about a missing device and an empty audience, and omits segments for email', async () => {
      const campaign = makeCampaign({
        channel: Channel.EMAIL,
        device: undefined,
      })
      givenCampaign(campaign)
      mockTemplateModel.findOne.mockReturnValue(
        chain({ ...smsTemplate, channel: Channel.EMAIL, subject: 'Hi' }),
      )
      givenAudience([contact({ email: undefined })])
      const preview = await service.previewCampaign(
        campaign._id.toString(),
        user,
      )
      expect(preview.eligibleCount).toBe(0)
      expect(preview.skippedByReason[SkipReason.INVALID_ADDRESS]).toBe(1)
      expect(preview.segmentsPerMessage).toBeUndefined()
      expect(preview.totalSegments).toBeUndefined()
      expect(preview.warnings.some((w) => /nobody/i.test(w))).toBe(true)
    })

    it('includes the wait for the window in the estimate when the window is closed', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-10T05:00:00Z'))
      try {
        const campaign = makeCampaign()
        givenCampaign(campaign)
        givenAudience([contact()])
        const preview = await service.previewCampaign(
          campaign._id.toString(),
          user,
        )
        expect(preview.windowOpenNow).toBe(false)
        expect(preview.nextWindowOpeningAt).toBe('2026-03-10T09:00:00.000Z')
        expect(preview.estimatedDurationMs).toBe(4 * 3600_000)
        expect(preview.warnings.some((w) => /window is closed/i.test(w))).toBe(
          true,
        )
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('pauseCampaign', () => {
    it('refuses unless the campaign is sending', async () => {
      const campaign = makeCampaign({ status: CampaignStatus.DRAFT })
      givenCampaign(campaign)
      await expect(
        service.pauseCampaign(campaign._id.toString(), user),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT })
    })

    it("marks PAUSED and removes only this campaign's pending jobs", async () => {
      const campaign = makeCampaign({ status: CampaignStatus.SENDING })
      givenCampaign(campaign)
      const mine = {
        id: '1',
        data: { campaignId: campaign._id.toString() },
        remove: jest.fn(),
      }
      const theirs = {
        id: '2',
        data: { campaignId: 'other' },
        remove: jest.fn(),
      }
      const stuck = {
        id: '3',
        data: { campaignId: campaign._id.toString() },
        remove: jest.fn().mockRejectedValue(new Error('locked')),
      }
      mockQueue.getJobs.mockResolvedValue([mine, theirs, stuck])

      await service.pauseCampaign(campaign._id.toString(), user)

      expect(mockCampaignModel.updateOne).toHaveBeenCalledWith(
        { _id: campaign._id },
        { $set: { status: CampaignStatus.PAUSED } },
      )
      expect(mockQueue.getJobs).toHaveBeenCalledWith([
        'delayed',
        'waiting',
        'paused',
      ])
      expect(mine.remove).toHaveBeenCalled()
      expect(stuck.remove).toHaveBeenCalled()
      expect(theirs.remove).not.toHaveBeenCalled()
    })
  })

  describe('resumeCampaign', () => {
    it('refuses unless paused', async () => {
      const campaign = makeCampaign({ status: CampaignStatus.SENDING })
      givenCampaign(campaign)
      await expect(
        service.resumeCampaign(campaign._id.toString(), user),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT })
    })

    it('re-enqueues every QUEUED send and flips back to SENDING', async () => {
      const campaign = makeCampaign({ status: CampaignStatus.PAUSED })
      givenCampaign(campaign)
      const queued = [
        { _id: new Types.ObjectId() },
        { _id: new Types.ObjectId() },
      ]
      mockSendModel.find.mockReturnValue(chain(queued))

      await service.resumeCampaign(campaign._id.toString(), user)

      expect(mockSendModel.find).toHaveBeenCalledWith(
        { campaign: campaign._id, status: SendStatus.QUEUED },
        { _id: 1 },
      )
      expect(mockCampaignModel.updateOne).toHaveBeenCalledWith(
        { _id: campaign._id },
        { $set: { status: CampaignStatus.SENDING } },
      )
      const jobs = mockQueue.addBulk.mock.calls[0][0]
      expect(jobs.map((j) => j.data.sendId)).toEqual(
        queued.map((q) => q._id.toString()),
      )
    })

    it('completes when nothing is left to send', async () => {
      const campaign = makeCampaign({ status: CampaignStatus.PAUSED })
      givenCampaign(campaign)
      mockSendModel.find.mockReturnValue(chain([]))
      await service.resumeCampaign(campaign._id.toString(), user)
      expect(mockQueue.addBulk).not.toHaveBeenCalled()
      expect(mockCampaignModel.updateOne).toHaveBeenCalledWith(
        { _id: campaign._id },
        {
          $set: {
            status: CampaignStatus.COMPLETED,
            completedAt: expect.any(Date),
          },
        },
      )
    })
  })

  describe('cancelCampaign', () => {
    it('refuses when already finished', async () => {
      const campaign = makeCampaign({ status: CampaignStatus.COMPLETED })
      givenCampaign(campaign)
      await expect(
        service.cancelCampaign(campaign._id.toString(), user),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT })
    })

    it('fails the remaining QUEUED sends and the campaign, then drops the jobs', async () => {
      const campaign = makeCampaign({ status: CampaignStatus.SENDING })
      givenCampaign(campaign)
      const job = {
        id: '1',
        data: { campaignId: campaign._id.toString() },
        remove: jest.fn(),
      }
      mockQueue.getJobs.mockResolvedValue([job])

      await service.cancelCampaign(campaign._id.toString(), user)

      expect(mockCampaignModel.updateOne).toHaveBeenCalledWith(
        { _id: campaign._id },
        {
          $set: expect.objectContaining({
            status: CampaignStatus.FAILED,
            error: 'Cancelled by user',
          }),
        },
      )
      expect(job.remove).toHaveBeenCalled()
      expect(mockSendModel.updateMany).toHaveBeenCalledWith(
        { campaign: campaign._id, status: SendStatus.QUEUED },
        {
          $set: expect.objectContaining({
            status: SendStatus.FAILED,
            errorCode: 'campaign_cancelled',
          }),
        },
      )
    })
  })

  describe('getCampaignReport', () => {
    it('returns counts by status, the skip breakdown and the failures', async () => {
      const campaign = makeCampaign({ status: CampaignStatus.COMPLETED })
      givenCampaign(campaign)
      mockSendModel.aggregate
        .mockResolvedValueOnce([
          { _id: SendStatus.SENT, count: 7 },
          { _id: SendStatus.FAILED, count: 1 },
          { _id: SendStatus.SKIPPED, count: 2 },
        ])
        .mockResolvedValueOnce([{ _id: SkipReason.SUPPRESSED, count: 2 }])
      const contactId = new Types.ObjectId()
      mockSendModel.find.mockReturnValue(
        chain([
          {
            _id: new Types.ObjectId(),
            contact: { _id: contactId, name: 'Bir' },
            recipient: '+9779800000002',
            errorCode: '400',
            errorMessage: 'Device does not exist or is not enabled',
            attempts: 2,
            failedAt: new Date('2026-03-10T10:00:00Z'),
          },
        ]),
      )

      const report = await service.getCampaignReport(
        campaign._id.toString(),
        user,
      )

      expect(report.campaign).toMatchObject({
        id: campaign._id.toString(),
        status: CampaignStatus.COMPLETED,
      })
      expect(report.totals).toEqual({
        queued: 0,
        sent: 7,
        delivered: 0,
        failed: 1,
        skipped: 2,
        total: 10,
      })
      expect(report.skippedByReason).toEqual({
        [SkipReason.SUPPRESSED]: 2,
        [SkipReason.NO_CONSENT]: 0,
        [SkipReason.DUPLICATE]: 0,
        [SkipReason.INVALID_ADDRESS]: 0,
        [SkipReason.ALREADY_SENT]: 0,
      })
      expect(report.failures).toEqual([
        {
          sendId: expect.any(String),
          contact: { id: contactId.toString(), name: 'Bir' },
          recipient: '+9779800000002',
          errorCode: '400',
          errorMessage: 'Device does not exist or is not enabled',
          attempts: 2,
          failedAt: new Date('2026-03-10T10:00:00Z'),
        },
      ])
      expect(mockSendModel.find).toHaveBeenCalledWith({
        campaign: campaign._id,
        status: SendStatus.FAILED,
      })
    })
  })

  describe('recomputeStats', () => {
    it('rebuilds every counter and the skip breakdown from the send rows', async () => {
      const campaignId = new Types.ObjectId()
      mockSendModel.aggregate.mockResolvedValue([
        { _id: { status: SendStatus.QUEUED }, count: 4 },
        { _id: { status: SendStatus.SENT }, count: 3 },
        { _id: { status: SendStatus.DELIVERED }, count: 2 },
        { _id: { status: SendStatus.FAILED }, count: 1 },
        {
          _id: { status: SendStatus.SKIPPED, skipReason: SkipReason.DUPLICATE },
          count: 5,
        },
        {
          _id: {
            status: SendStatus.SKIPPED,
            skipReason: SkipReason.SUPPRESSED,
          },
          count: 1,
        },
      ])
      await service.recomputeStats(campaignId)
      expect(mockCampaignModel.updateOne).toHaveBeenCalledWith(
        { _id: campaignId },
        {
          $set: {
            stats: {
              picked: 16,
              queued: 4,
              sent: 3,
              delivered: 2,
              failed: 1,
              skipped: 6,
              skippedByReason: { duplicate: 5, suppressed: 1 },
            },
          },
        },
      )
    })
  })
})
