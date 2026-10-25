import { InjectQueue, Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Job, Queue } from 'bull'
import { Model, Types } from 'mongoose'
import { Campaign, CampaignDocument } from './schemas/campaign.schema'
import { Send, SendDocument } from './schemas/send.schema'
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema'
import { User } from '../users/schemas/user.schema'
import { GatewayService } from '../gateway/gateway.service'
import { EmailService } from '../email/email.service'
import { SuppressionService } from '../suppression/suppression.service'
import {
  CampaignStatus,
  Channel,
  DEFAULT_PACING,
  SendLane,
  SendStatus,
  SkipReason,
} from '../sendline/sendline.enums'
import { hasConsentForChannel } from './audience-resolution'
import {
  computeReleaseDelayMs,
  isInsideSendWindow,
  MS_PER_DAY,
  nextWindowOpening,
  PacingConfig,
  remainingDailyAllowance,
  startOfLocalDay,
} from './send-pacing'
import {
  MAX_SEND_ATTEMPTS,
  SEND_DISPATCH_CONCURRENCY,
  SEND_RETRY_DELAY_MS,
  SENDLINE_SENDS_QUEUE,
  SendJobData,
} from './send-queue.constants'

export type DispatchOutcome =
  | { outcome: 'sent'; providerId?: string }
  | { outcome: 'failed'; errorCode?: string; errorMessage: string }
  | { outcome: 'retry'; attempts: number; errorMessage: string }
  | { outcome: 'skipped'; reason: SkipReason }
  | { outcome: 'deferred'; until: Date; why: 'window' | 'daily-cap' }
  | { outcome: 'ignored'; why: string }

/**
 * Consumes `{ sendId }` jobs and turns a QUEUED Send into SENT or FAILED.
 *
 * Between enqueue and now the world may have changed: the person may have
 * replied STOP, the day's allowance may be gone, the window may have closed,
 * the operator may have paused. Every one of those is re-checked here, right
 * before the message leaves, because this is the last place it can be.
 */
@Processor(SENDLINE_SENDS_QUEUE)
export class SendDispatchProcessor {
  private readonly logger = new Logger(SendDispatchProcessor.name)

  constructor(
    @InjectModel(Send.name) private sendModel: Model<SendDocument>,
    @InjectModel(Campaign.name)
    private campaignModel: Model<CampaignDocument>,
    @InjectModel(Contact.name) private contactModel: Model<ContactDocument>,
    @InjectQueue(SENDLINE_SENDS_QUEUE)
    private sendQueue: Queue<SendJobData>,
    private gatewayService: GatewayService,
    private emailService: EmailService,
    private suppressionService: SuppressionService,
  ) {}

  @Process({ concurrency: SEND_DISPATCH_CONCURRENCY })
  async handleSend(job: Job<SendJobData>): Promise<DispatchOutcome> {
    const { sendId } = job.data ?? ({} as SendJobData)
    if (!sendId || !Types.ObjectId.isValid(sendId)) {
      return { outcome: 'ignored', why: 'invalid sendId' }
    }

    const send = await this.sendModel.findById(sendId).exec()
    if (!send) {
      return { outcome: 'ignored', why: 'send not found' }
    }
    if (send.status !== SendStatus.QUEUED) {
      return { outcome: 'ignored', why: `send is ${send.status}` }
    }

    const campaign = send.campaign
      ? await this.campaignModel.findById(send.campaign).exec()
      : null
    if (send.campaign && !campaign) {
      return { outcome: 'ignored', why: 'campaign not found' }
    }
    if (campaign && campaign.status !== CampaignStatus.SENDING) {
      // Paused: resume re-enqueues. Cancelled/failed: nothing to do.
      return { outcome: 'ignored', why: `campaign is ${campaign.status}` }
    }

    const user = { _id: send.user } as User

    // 1. Suppression, re-checked at the last possible moment.
    const suppressed = await this.suppressionService.isSuppressed(
      send.recipient,
      send.channel,
      user,
    )
    if (suppressed) {
      await this.markSkipped(send, campaign, SkipReason.SUPPRESSED)
      await this.maybeComplete(campaign)
      return { outcome: 'skipped', reason: SkipReason.SUPPRESSED }
    }

    // 2. Consent on the contact itself (an opt-out may be recorded there only).
    if (send.lane === SendLane.MARKETING && send.contact) {
      const contact = await this.contactModel
        .findById(send.contact)
        .lean()
        .exec()
      if (contact && !hasConsentForChannel(contact, send.channel)) {
        await this.markSkipped(send, campaign, SkipReason.NO_CONSENT)
        await this.maybeComplete(campaign)
        return { outcome: 'skipped', reason: SkipReason.NO_CONSENT }
      }
    }

    // 3. Pacing: window and daily cap. Marketing only.
    if (send.lane === SendLane.MARKETING && campaign) {
      const pacing = this.pacingOf(campaign)
      const now = new Date()

      if (!isInsideSendWindow(now, pacing)) {
        const until = nextWindowOpening(now, pacing)
        await this.defer(send, campaign, until, now)
        return { outcome: 'deferred', until, why: 'window' }
      }

      const dayStart = startOfLocalDay(now, pacing.timezone)
      const sentToday = await this.sendModel.countDocuments({
        user: send.user,
        channel: send.channel,
        lane: SendLane.MARKETING,
        status: { $in: [SendStatus.SENT, SendStatus.DELIVERED] },
        sentAt: { $gte: dayStart },
      })
      if (remainingDailyAllowance(sentToday, pacing.dailyCap) <= 0) {
        const tomorrow = new Date(dayStart.getTime() + MS_PER_DAY)
        const until = nextWindowOpening(tomorrow, pacing)
        await this.defer(send, campaign, until, now)
        return { outcome: 'deferred', until, why: 'daily-cap' }
      }
    }

    // 4. Dispatch.
    const attempts = (send.attempts ?? 0) + 1
    try {
      const providerId = await this.dispatch(send, campaign)
      await this.markSent(send, campaign, providerId, attempts)
      await this.maybeComplete(campaign)
      return { outcome: 'sent', providerId }
    } catch (e) {
      const { errorCode, errorMessage } = this.describeError(e)
      if (attempts < MAX_SEND_ATTEMPTS) {
        await this.sendModel
          .updateOne(
            { _id: send._id },
            { $set: { attempts, errorCode, errorMessage } },
          )
          .exec()
        await this.sendQueue.add(
          { sendId: send._id.toString(), campaignId: job.data.campaignId },
          {
            jobId: `${send._id.toString()}:retry${attempts}`,
            delay: SEND_RETRY_DELAY_MS,
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: false,
          },
        )
        this.logger.warn(
          `Send ${send._id} attempt ${attempts} failed (${errorMessage}); retrying`,
        )
        return { outcome: 'retry', attempts, errorMessage }
      }
      await this.markFailed(send, campaign, attempts, errorCode, errorMessage)
      await this.maybeComplete(campaign)
      this.logger.error(`Send ${send._id} failed for good: ${errorMessage}`)
      return { outcome: 'failed', errorCode, errorMessage }
    }
  }

  // ------------------------------------------------------------ dispatch

  private async dispatch(
    send: Send,
    campaign: Campaign | null,
  ): Promise<string | undefined> {
    const body = send.renderedBody ?? ''
    if (!body.trim()) {
      throw Object.assign(new Error('Rendered body is empty'), {
        code: 'empty_body',
      })
    }

    if (send.channel === Channel.SMS) {
      const deviceId = campaign?.device?.toString()
      if (!deviceId) {
        throw Object.assign(new Error('No sending device on the campaign'), {
          code: 'no_device',
        })
      }
      const response = await this.gatewayService.sendSMS(deviceId, {
        message: body,
        recipients: [send.recipient],
        // Legacy fields the DTO still declares.
        smsBody: body,
        receivers: [send.recipient],
      })
      return this.smsProviderId(response)
    }

    const result = await this.emailService.sendEmail({
      to: send.recipient,
      subject: send.subject ?? '',
      body,
    })
    return result?.messageId
  }

  /**
   * GatewayService.sendSMS returns either a queue acknowledgement with
   * `smsBatchId` or a Firebase BatchResponse. Take whichever id exists.
   */
  private smsProviderId(response: any): string | undefined {
    if (!response) {
      return undefined
    }
    if (response.smsBatchId) {
      return String(response.smsBatchId)
    }
    const first = response.responses?.[0]
    if (first?.success === false) {
      throw Object.assign(
        new Error(first.error?.message ?? 'FCM rejected the message'),
        { code: first.error?.code ?? 'fcm_rejected' },
      )
    }
    return first?.messageId ?? undefined
  }

  // -------------------------------------------------------- transitions

  private async markSent(
    send: Send,
    campaign: Campaign | null,
    providerId: string | undefined,
    attempts: number,
  ): Promise<void> {
    const sentAt = new Date()
    await this.sendModel
      .updateOne(
        { _id: send._id },
        {
          $set: { status: SendStatus.SENT, sentAt, providerId, attempts },
          $unset: { errorCode: '', errorMessage: '' },
        },
      )
      .exec()
    if (campaign) {
      await this.campaignModel
        .updateOne(
          { _id: campaign._id },
          { $inc: { 'stats.sent': 1, 'stats.queued': -1 } },
        )
        .exec()
    }
    if (send.contact) {
      await this.contactModel
        .updateOne({ _id: send.contact }, { $set: { lastMessagedAt: sentAt } })
        .exec()
    }
  }

  private async markFailed(
    send: Send,
    campaign: Campaign | null,
    attempts: number,
    errorCode: string | undefined,
    errorMessage: string,
  ): Promise<void> {
    await this.sendModel
      .updateOne(
        { _id: send._id },
        {
          $set: {
            status: SendStatus.FAILED,
            failedAt: new Date(),
            attempts,
            errorCode,
            errorMessage,
          },
        },
      )
      .exec()
    if (campaign) {
      await this.campaignModel
        .updateOne(
          { _id: campaign._id },
          { $inc: { 'stats.failed': 1, 'stats.queued': -1 } },
        )
        .exec()
    }
  }

  private async markSkipped(
    send: Send,
    campaign: Campaign | null,
    reason: SkipReason,
  ): Promise<void> {
    await this.sendModel
      .updateOne(
        { _id: send._id },
        { $set: { status: SendStatus.SKIPPED, skipReason: reason } },
      )
      .exec()
    if (campaign) {
      await this.campaignModel
        .updateOne(
          { _id: campaign._id },
          {
            $inc: {
              'stats.skipped': 1,
              'stats.queued': -1,
              [`stats.skippedByReason.${reason}`]: 1,
            },
          },
        )
        .exec()
    }
    this.logger.log(`Send ${send._id} skipped at dispatch: ${reason}`)
  }

  /**
   * Puts the job back with a delay. Deferred sends of one campaign are spread
   * by their position so they do not all fire the instant the window opens.
   */
  private async defer(
    send: Send,
    campaign: Campaign,
    until: Date,
    now: Date,
  ): Promise<void> {
    const pacing = this.pacingOf(campaign)
    const position = await this.sendModel.countDocuments({
      campaign: campaign._id,
      status: SendStatus.QUEUED,
      _id: { $lt: send._id },
    })
    const delay =
      Math.max(0, until.getTime() - now.getTime()) +
      computeReleaseDelayMs(position, pacing.ratePerMinute, pacing.jitterMs)
    await this.sendQueue.add(
      { sendId: send._id.toString(), campaignId: campaign._id.toString() },
      {
        jobId: `${send._id.toString()}:d${until.getTime()}`,
        delay,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    )
  }

  /** Marks the campaign COMPLETED once no QUEUED send remains. */
  private async maybeComplete(campaign: Campaign | null): Promise<void> {
    if (!campaign) {
      return
    }
    const remaining = await this.sendModel.countDocuments({
      campaign: campaign._id,
      status: SendStatus.QUEUED,
    })
    if (remaining > 0) {
      return
    }
    await this.campaignModel
      .updateOne(
        { _id: campaign._id, status: CampaignStatus.SENDING },
        { $set: { status: CampaignStatus.COMPLETED, completedAt: new Date() } },
      )
      .exec()
  }

  // ------------------------------------------------------------- helpers

  private pacingOf(campaign: Campaign): PacingConfig {
    const stored: Partial<PacingConfig> = campaign.pacing
      ? typeof (campaign.pacing as any).toObject === 'function'
        ? (campaign.pacing as any).toObject()
        : campaign.pacing
      : {}
    return { ...DEFAULT_PACING, ...stored }
  }

  private describeError(e: any): { errorCode?: string; errorMessage: string } {
    const response =
      typeof e?.getResponse === 'function' ? e.getResponse() : null
    const errorMessage: string =
      response?.error ??
      e?.message ??
      (typeof e === 'string' ? e : 'Unknown error')
    const rawCode = e?.code ?? e?.errorCode ?? e?.status ?? response?.statusCode
    const errorCode = rawCode !== undefined ? String(rawCode) : undefined
    return { errorCode, errorMessage: String(errorMessage).slice(0, 1000) }
  }
}
