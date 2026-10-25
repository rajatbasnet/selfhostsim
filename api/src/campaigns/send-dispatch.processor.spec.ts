import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { getQueueToken } from '@nestjs/bull'
import { HttpException, HttpStatus } from '@nestjs/common'
import { Types } from 'mongoose'
import { SendDispatchProcessor } from './send-dispatch.processor'
import { Campaign } from './schemas/campaign.schema'
import { Send } from './schemas/send.schema'
import { Contact } from '../contacts/schemas/contact.schema'
import { GatewayService } from '../gateway/gateway.service'
import { EmailService } from '../email/email.service'
import { SuppressionService } from '../suppression/suppression.service'
import {
  MAX_SEND_ATTEMPTS,
  SEND_RETRY_DELAY_MS,
  SENDLINE_SENDS_QUEUE,
} from './send-queue.constants'
import {
  CampaignStatus,
  Channel,
  DEFAULT_PACING,
  SendLane,
  SendStatus,
  SkipReason,
} from '../sendline/sendline.enums'

const chain = (result: any) => {
  const q: any = {}
  for (const m of ['sort', 'limit', 'populate', 'lean', 'select']) {
    q[m] = jest.fn().mockReturnValue(q)
  }
  q.exec = jest.fn().mockResolvedValue(result)
  return q
}

describe('SendDispatchProcessor', () => {
  let processor: SendDispatchProcessor

  const mockSendModel = {
    findById: jest.fn(),
    updateOne: jest.fn(),
    countDocuments: jest.fn(),
  }
  const mockCampaignModel = { findById: jest.fn(), updateOne: jest.fn() }
  const mockContactModel = { findById: jest.fn(), updateOne: jest.fn() }
  const mockQueue = { add: jest.fn() }
  const mockGatewayService = { sendSMS: jest.fn() }
  const mockEmailService = { sendEmail: jest.fn() }
  const mockSuppressionService = { isSuppressed: jest.fn() }

  const userId = new Types.ObjectId()
  const deviceId = new Types.ObjectId()

  const makeCampaign = (overrides: Partial<Campaign> = {}): any => ({
    _id: new Types.ObjectId(),
    user: userId,
    channel: Channel.SMS,
    device: deviceId,
    status: CampaignStatus.SENDING,
    pacing: { ...DEFAULT_PACING, windowStartHour: 0, windowEndHour: 0 },
    ...overrides,
  })

  const makeSend = (campaign: any, overrides: Partial<Send> = {}): any => ({
    _id: new Types.ObjectId(),
    user: userId,
    campaign: campaign._id,
    contact: new Types.ObjectId(),
    channel: campaign.channel,
    lane: SendLane.MARKETING,
    recipient: campaign.channel === Channel.SMS ? '+9779800000001' : 'a@x.io',
    subject: campaign.channel === Channel.EMAIL ? 'Hello' : undefined,
    renderedBody: 'Hi Asha. Reply STOP to opt out.',
    status: SendStatus.QUEUED,
    attempts: 0,
    ...overrides,
  })

  const job = (send: any, campaign: any): any => ({
    id: send._id.toString(),
    data: { sendId: send._id.toString(), campaignId: campaign._id.toString() },
  })

  const given = (send: any, campaign: any, contact: any = { smsConsent: true, emailConsent: true }) => {
    mockSendModel.findById.mockReturnValue(chain(send))
    mockCampaignModel.findById.mockReturnValue(chain(campaign))
    mockContactModel.findById.mockReturnValue(chain(contact))
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendDispatchProcessor,
        { provide: getModelToken(Send.name), useValue: mockSendModel },
        { provide: getModelToken(Campaign.name), useValue: mockCampaignModel },
        { provide: getModelToken(Contact.name), useValue: mockContactModel },
        { provide: getQueueToken(SENDLINE_SENDS_QUEUE), useValue: mockQueue },
        { provide: GatewayService, useValue: mockGatewayService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: SuppressionService, useValue: mockSuppressionService },
      ],
    }).compile()

    processor = module.get<SendDispatchProcessor>(SendDispatchProcessor)

    jest.clearAllMocks()
    jest.useRealTimers()
    mockSendModel.updateOne.mockReturnValue(chain({ modifiedCount: 1 }))
    mockCampaignModel.updateOne.mockReturnValue(chain({ modifiedCount: 1 }))
    mockContactModel.updateOne.mockReturnValue(chain({ modifiedCount: 1 }))
    mockSendModel.countDocuments.mockResolvedValue(0)
    mockSuppressionService.isSuppressed.mockResolvedValue(false)
    mockQueue.add.mockResolvedValue({})
    mockGatewayService.sendSMS.mockResolvedValue({
      success: true,
      smsBatchId: new Types.ObjectId('65f000000000000000000001'),
    })
    mockEmailService.sendEmail.mockResolvedValue({ messageId: '<abc@mail>' })
  })

  const sendUpdate = () =>
    mockSendModel.updateOne.mock.calls.map((c) => c[1]).find((u) => u.$set?.status)

  it('ignores a job whose send is no longer QUEUED', async () => {
    const campaign = makeCampaign()
    const send = makeSend(campaign, { status: SendStatus.SENT })
    given(send, campaign)
    const result = await processor.handleSend(job(send, campaign))
    expect(result.outcome).toBe('ignored')
    expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
  })

  it('leaves the send QUEUED and does nothing when the campaign is paused', async () => {
    const campaign = makeCampaign({ status: CampaignStatus.PAUSED })
    const send = makeSend(campaign)
    given(send, campaign)
    const result = await processor.handleSend(job(send, campaign))
    expect(result).toEqual({ outcome: 'ignored', why: 'campaign is paused' })
    expect(mockSendModel.updateOne).not.toHaveBeenCalled()
    expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
  })

  it('re-checks suppression right before dispatch and skips a recipient who replied STOP', async () => {
    const campaign = makeCampaign()
    const send = makeSend(campaign)
    given(send, campaign)
    mockSuppressionService.isSuppressed.mockResolvedValue(true)

    const result = await processor.handleSend(job(send, campaign))

    expect(mockSuppressionService.isSuppressed).toHaveBeenCalledWith(
      '+9779800000001',
      Channel.SMS,
      { _id: userId },
    )
    expect(result).toEqual({ outcome: 'skipped', reason: SkipReason.SUPPRESSED })
    expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
    expect(mockSendModel.updateOne).toHaveBeenCalledWith(
      { _id: send._id },
      { $set: { status: SendStatus.SKIPPED, skipReason: SkipReason.SUPPRESSED } },
    )
    expect(mockCampaignModel.updateOne).toHaveBeenCalledWith(
      { _id: campaign._id },
      {
        $inc: {
          'stats.skipped': 1,
          'stats.queued': -1,
          'stats.skippedByReason.suppressed': 1,
        },
      },
    )
  })

  it('skips when the contact opted out since the campaign was queued', async () => {
    const campaign = makeCampaign()
    const send = makeSend(campaign)
    given(send, campaign, { smsConsent: true, optedOutAt: new Date() })
    const result = await processor.handleSend(job(send, campaign))
    expect(result).toEqual({ outcome: 'skipped', reason: SkipReason.NO_CONSENT })
    expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
  })

  it('defers to the next window opening when the window is closed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-10T05:00:00Z'))
    const campaign = makeCampaign({ pacing: { ...DEFAULT_PACING } })
    const send = makeSend(campaign)
    given(send, campaign)
    mockSendModel.countDocuments.mockResolvedValue(0)

    const result = await processor.handleSend(job(send, campaign))

    expect(result).toMatchObject({ outcome: 'deferred', why: 'window' })
    expect((result as any).until).toEqual(new Date('2026-03-10T09:00:00Z'))
    expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
    expect(mockQueue.add).toHaveBeenCalledTimes(1)
    const [data, opts] = mockQueue.add.mock.calls[0]
    expect(data).toEqual({ sendId: send._id.toString(), campaignId: campaign._id.toString() })
    expect(opts.delay).toBeGreaterThanOrEqual(4 * 3600_000 - DEFAULT_PACING.jitterMs)
    expect(opts.delay).toBeLessThanOrEqual(4 * 3600_000 + DEFAULT_PACING.jitterMs)
    expect(opts.jobId).not.toBe(send._id.toString())
    // The send row stays QUEUED.
    expect(sendUpdate()).toBeUndefined()
  })

  it('defers to tomorrow when the daily cap is exhausted', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-10T12:00:00Z'))
    const campaign = makeCampaign({ pacing: { ...DEFAULT_PACING, dailyCap: 500 } })
    const send = makeSend(campaign)
    given(send, campaign)
    // First count: sent today (cap hit). Second: queue position for spreading.
    mockSendModel.countDocuments.mockResolvedValueOnce(500).mockResolvedValueOnce(0)

    const result = await processor.handleSend(job(send, campaign))

    expect(result).toMatchObject({ outcome: 'deferred', why: 'daily-cap' })
    expect((result as any).until).toEqual(new Date('2026-03-11T09:00:00Z'))
    expect(mockSendModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        user: userId,
        channel: Channel.SMS,
        lane: SendLane.MARKETING,
        status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] },
        sentAt: { $gte: new Date('2026-03-10T00:00:00Z') },
      }),
    )
    expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
    expect(mockQueue.add).toHaveBeenCalledTimes(1)
  })

  it('counts the day in the campaign timezone', async () => {
    // 01:00Z on the 11th is still the 10th in New York (-5): day start is 05:00Z on the 10th.
    jest.useFakeTimers().setSystemTime(new Date('2026-03-11T01:00:00Z'))
    const campaign = makeCampaign({
      pacing: { ...DEFAULT_PACING, windowStartHour: 0, windowEndHour: 0, timezone: 'America/New_York' },
    })
    const send = makeSend(campaign)
    given(send, campaign)
    await processor.handleSend(job(send, campaign))
    expect(mockSendModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ sentAt: { $gte: new Date('2026-03-10T05:00:00Z') } }),
    )
  })

  it('dispatches SMS through the gateway and marks SENT with the provider id', async () => {
    const campaign = makeCampaign()
    const send = makeSend(campaign)
    given(send, campaign)

    const result = await processor.handleSend(job(send, campaign))

    expect(mockGatewayService.sendSMS).toHaveBeenCalledWith(
      deviceId.toString(),
      expect.objectContaining({
        message: 'Hi Asha. Reply STOP to opt out.',
        recipients: ['+9779800000001'],
      }),
    )
    expect(result).toEqual({ outcome: 'sent', providerId: '65f000000000000000000001' })
    expect(mockSendModel.updateOne).toHaveBeenCalledWith(
      { _id: send._id },
      {
        $set: {
          status: SendStatus.SENT,
          sentAt: expect.any(Date),
          providerId: '65f000000000000000000001',
          attempts: 1,
        },
        $unset: { errorCode: '', errorMessage: '' },
      },
    )
    expect(mockCampaignModel.updateOne).toHaveBeenCalledWith(
      { _id: campaign._id },
      { $inc: { 'stats.sent': 1, 'stats.queued': -1 } },
    )
    expect(mockContactModel.updateOne).toHaveBeenCalledWith(
      { _id: send.contact },
      { $set: { lastMessagedAt: expect.any(Date) } },
    )
  })

  it('takes the FCM message id when the gateway sends directly', async () => {
    const campaign = makeCampaign()
    const send = makeSend(campaign)
    given(send, campaign)
    mockGatewayService.sendSMS.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true, messageId: 'projects/x/messages/1' }],
    })
    const result = await processor.handleSend(job(send, campaign))
    expect(result).toEqual({ outcome: 'sent', providerId: 'projects/x/messages/1' })
  })

  it('dispatches email through EmailService and stores the SMTP message id', async () => {
    const campaign = makeCampaign({ channel: Channel.EMAIL, device: undefined })
    const send = makeSend(campaign, { renderedBody: 'Welcome' })
    given(send, campaign)

    const result = await processor.handleSend(job(send, campaign))

    expect(mockEmailService.sendEmail).toHaveBeenCalledWith({
      to: 'a@x.io',
      subject: 'Hello',
      body: 'Welcome',
    })
    expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
    expect(result).toEqual({ outcome: 'sent', providerId: '<abc@mail>' })
  })

  it('marks the campaign COMPLETED when the last queued send finishes', async () => {
    const campaign = makeCampaign()
    const send = makeSend(campaign)
    given(send, campaign)
    mockSendModel.countDocuments.mockResolvedValue(0)
    await processor.handleSend(job(send, campaign))
    expect(mockCampaignModel.updateOne).toHaveBeenCalledWith(
      { _id: campaign._id, status: CampaignStatus.SENDING },
      { $set: { status: CampaignStatus.COMPLETED, completedAt: expect.any(Date) } },
    )
  })

  it('does not complete the campaign while sends remain queued', async () => {
    const campaign = makeCampaign()
    const send = makeSend(campaign)
    given(send, campaign)
    // daily-cap count, then remaining-queued count
    mockSendModel.countDocuments.mockResolvedValueOnce(3).mockResolvedValueOnce(2)
    await processor.handleSend(job(send, campaign))
    const completion = mockCampaignModel.updateOne.mock.calls.find(
      (c) => c[1].$set?.status === CampaignStatus.COMPLETED,
    )
    expect(completion).toBeUndefined()
  })

  it('retries once on failure, keeping the send QUEUED with the error recorded', async () => {
    const campaign = makeCampaign()
    const send = makeSend(campaign)
    given(send, campaign)
    mockGatewayService.sendSMS.mockRejectedValue(
      new HttpException(
        { success: false, error: 'Device does not exist or is not enabled' },
        HttpStatus.BAD_REQUEST,
      ),
    )

    const result = await processor.handleSend(job(send, campaign))

    expect(result).toEqual({
      outcome: 'retry',
      attempts: 1,
      errorMessage: 'Device does not exist or is not enabled',
    })
    expect(mockSendModel.updateOne).toHaveBeenCalledWith(
      { _id: send._id },
      {
        $set: {
          attempts: 1,
          errorCode: '400',
          errorMessage: 'Device does not exist or is not enabled',
        },
      },
    )
    expect(sendUpdate()).toBeUndefined()
    expect(mockQueue.add).toHaveBeenCalledWith(
      { sendId: send._id.toString(), campaignId: campaign._id.toString() },
      expect.objectContaining({
        delay: SEND_RETRY_DELAY_MS,
        jobId: `${send._id.toString()}:retry1`,
      }),
    )
    // Stats untouched until the outcome is final.
    expect(mockCampaignModel.updateOne).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $inc: expect.anything() }),
    )
  })

  it('leaves the send FAILED after the final attempt and keeps stats in step', async () => {
    const campaign = makeCampaign()
    const send = makeSend(campaign, { attempts: MAX_SEND_ATTEMPTS - 1 })
    given(send, campaign)
    mockGatewayService.sendSMS.mockRejectedValue(
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    )

    const result = await processor.handleSend(job(send, campaign))

    expect(result).toEqual({
      outcome: 'failed',
      errorCode: 'ECONNRESET',
      errorMessage: 'socket hang up',
    })
    expect(mockQueue.add).not.toHaveBeenCalled()
    expect(mockSendModel.updateOne).toHaveBeenCalledWith(
      { _id: send._id },
      {
        $set: {
          status: SendStatus.FAILED,
          failedAt: expect.any(Date),
          attempts: MAX_SEND_ATTEMPTS,
          errorCode: 'ECONNRESET',
          errorMessage: 'socket hang up',
        },
      },
    )
    expect(mockCampaignModel.updateOne).toHaveBeenCalledWith(
      { _id: campaign._id },
      { $inc: { 'stats.failed': 1, 'stats.queued': -1 } },
    )
  })

  it('fails an SMS send whose campaign has no device instead of calling the gateway', async () => {
    const campaign = makeCampaign({ device: undefined })
    const send = makeSend(campaign, { attempts: MAX_SEND_ATTEMPTS - 1 })
    given(send, campaign)
    const result = await processor.handleSend(job(send, campaign))
    expect(result).toMatchObject({ outcome: 'failed', errorCode: 'no_device' })
    expect(mockGatewayService.sendSMS).not.toHaveBeenCalled()
  })

  it('treats a rejected FCM response as a failure', async () => {
    const campaign = makeCampaign()
    const send = makeSend(campaign, { attempts: MAX_SEND_ATTEMPTS - 1 })
    given(send, campaign)
    mockGatewayService.sendSMS.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [
        { success: false, error: { code: 'messaging/invalid-registration-token', message: 'bad token' } },
      ],
    })
    const result = await processor.handleSend(job(send, campaign))
    expect(result).toEqual({
      outcome: 'failed',
      errorCode: 'messaging/invalid-registration-token',
      errorMessage: 'bad token',
    })
  })
})
