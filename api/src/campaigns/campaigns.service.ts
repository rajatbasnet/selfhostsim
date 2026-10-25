import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { Model, Types } from 'mongoose'
import { Campaign, CampaignDocument } from './schemas/campaign.schema'
import { Send, SendDocument } from './schemas/send.schema'
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema'
import {
  MessageTemplate,
  MessageTemplateDocument,
} from '../templates/schemas/template.schema'
import { User } from '../users/schemas/user.schema'
import { ListsService } from '../lists/lists.service'
import { SuppressionService } from '../suppression/suppression.service'
import { countSmsSegments } from '../templates/sms-segmentation'
import {
  CampaignStatus,
  Channel,
  DEFAULT_PACING,
  SendLane,
  SendStatus,
  SkipReason,
} from '../sendline/sendline.enums'
import {
  CampaignPreviewDTO,
  CampaignPreviewSampleDTO,
  CreateCampaignDTO,
  UpdateCampaignDTO,
} from './campaigns.dto'
import {
  recipientForChannel,
  resolveAudience,
  ResolvedAudience,
  summarizeSkips,
} from './audience-resolution'
import {
  computeScheduledDelayMs,
  estimateSendDurationMs,
  isInsideSendWindow,
  nextWindowOpening,
  PacingConfig,
} from './send-pacing'
import { renderCampaignMessage } from './campaign-message'
import { SENDLINE_SENDS_QUEUE, SendJobData } from './send-queue.constants'

const PREVIEW_SAMPLE_SIZE = 3
const REPORT_FAILURE_LIMIT = 1000

/** Fields a client may change once the campaign has left DRAFT. */
const EDITABLE_WHILE_PAUSED = new Set(['name', 'pacing', 'scheduledAt'])

export interface CampaignReport {
  campaign: {
    id: string
    name: string
    channel: Channel
    status: CampaignStatus
    startedAt?: Date
    completedAt?: Date
    error?: string
    stats: Campaign['stats']
  }
  totals: Record<SendStatus, number> & { total: number }
  skippedByReason: Record<SkipReason, number>
  failures: Array<{
    sendId: string
    contact: { id: string; name?: string } | null
    recipient: string
    errorCode?: string
    errorMessage?: string
    attempts: number
    failedAt?: Date
  }>
}

type LeanContact = Contact & { _id: Types.ObjectId }

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name)

  constructor(
    @InjectModel(Campaign.name)
    private campaignModel: Model<CampaignDocument>,
    @InjectModel(Send.name) private sendModel: Model<SendDocument>,
    @InjectModel(Contact.name) private contactModel: Model<ContactDocument>,
    @InjectModel(MessageTemplate.name)
    private templateModel: Model<MessageTemplateDocument>,
    @InjectQueue(SENDLINE_SENDS_QUEUE)
    private sendQueue: Queue<SendJobData>,
    private listsService: ListsService,
    private suppressionService: SuppressionService,
  ) {}

  // ---------------------------------------------------------------- CRUD

  async createCampaign(
    input: CreateCampaignDTO,
    user: User,
  ): Promise<CampaignDocument> {
    this.assertChannelInputs(input.channel, input.device)
    const pacing = { ...DEFAULT_PACING, ...(input.pacing ?? {}) }
    return await this.campaignModel.create({
      user: user._id,
      name: input.name,
      channel: input.channel,
      template: new Types.ObjectId(input.template),
      list: new Types.ObjectId(input.list),
      device: input.device ? new Types.ObjectId(input.device) : undefined,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
      status: CampaignStatus.DRAFT,
      pacing,
    })
  }

  async getCampaignsForUser(user: User): Promise<CampaignDocument[]> {
    return await this.campaignModel
      .find({ user: user._id })
      .sort({ createdAt: -1 })
      .exec()
  }

  async getCampaignById(id: string, user: User): Promise<CampaignDocument> {
    const campaign = Types.ObjectId.isValid(id)
      ? await this.campaignModel.findOne({ _id: id, user: user._id }).exec()
      : null
    if (!campaign) {
      throw new HttpException(
        { error: 'Campaign not found' },
        HttpStatus.NOT_FOUND,
      )
    }
    return campaign
  }

  async updateCampaign(
    id: string,
    input: UpdateCampaignDTO,
    user: User,
  ): Promise<CampaignDocument> {
    const campaign = await this.getCampaignById(id, user)

    if (this.isTerminal(campaign.status)) {
      throw new HttpException(
        { error: `Campaign is ${campaign.status} and cannot be edited` },
        HttpStatus.CONFLICT,
      )
    }

    const changedKeys = Object.keys(input).filter(
      (key) => input[key] !== undefined,
    )
    const locked =
      campaign.status !== CampaignStatus.DRAFT &&
      campaign.status !== CampaignStatus.SCHEDULED
    if (locked) {
      const illegal = changedKeys.filter((k) => !EDITABLE_WHILE_PAUSED.has(k))
      if (illegal.length) {
        throw new HttpException(
          {
            error: `Only ${[...EDITABLE_WHILE_PAUSED].join(', ')} may change while ${campaign.status}`,
          },
          HttpStatus.CONFLICT,
        )
      }
    }

    const channel = input.channel ?? campaign.channel
    const device =
      input.device !== undefined ? input.device : campaign.device?.toString()
    this.assertChannelInputs(channel, device)

    const $set: Record<string, unknown> = {}
    if (input.name !== undefined) $set.name = input.name
    if (input.channel !== undefined) $set.channel = input.channel
    if (input.template !== undefined) {
      $set.template = new Types.ObjectId(input.template)
    }
    if (input.list !== undefined) $set.list = new Types.ObjectId(input.list)
    if (input.device !== undefined) {
      $set.device = input.device ? new Types.ObjectId(input.device) : null
    }
    if (input.scheduledAt !== undefined) {
      $set.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null
    }
    if (input.pacing !== undefined) {
      $set.pacing = { ...this.pacingOf(campaign), ...input.pacing }
    }

    const updated = await this.campaignModel
      .findOneAndUpdate(
        { _id: campaign._id, user: user._id },
        { $set },
        {
          new: true,
        },
      )
      .exec()
    return updated
  }

  async deleteCampaign(id: string, user: User): Promise<{ deleted: true }> {
    const campaign = await this.getCampaignById(id, user)
    if (campaign.status === CampaignStatus.SENDING) {
      throw new HttpException(
        { error: 'Pause or cancel the campaign before deleting it' },
        HttpStatus.CONFLICT,
      )
    }
    await this.removePendingJobs(campaign._id.toString())
    await this.sendModel.deleteMany({ campaign: campaign._id, user: user._id })
    await this.campaignModel.deleteOne({ _id: campaign._id, user: user._id })
    return { deleted: true }
  }

  // ------------------------------------------------------------- preview

  async previewCampaign(id: string, user: User): Promise<CampaignPreviewDTO> {
    const campaign = await this.getCampaignById(id, user)
    const template = await this.loadTemplate(campaign, user)
    const audience = await this.loadAudience(campaign, user)
    const pacing = this.pacingOf(campaign)
    const now = new Date()
    const warnings: string[] = []

    if (campaign.channel === Channel.SMS && !campaign.device) {
      warnings.push('No sending device selected; the campaign cannot start')
    }
    if (template.channel !== campaign.channel) {
      warnings.push(
        `Template is for ${template.channel} but the campaign is ${campaign.channel}`,
      )
    }

    const samples: CampaignPreviewSampleDTO[] = []
    const missingTags = new Set<string>()
    let totalSegments = 0

    audience.eligible.forEach((member, index) => {
      const message = renderCampaignMessage({
        template,
        contact: member.contact,
        channel: campaign.channel,
      })
      message.missing.forEach((tag) => missingTags.add(tag))
      const segments =
        campaign.channel === Channel.SMS
          ? countSmsSegments(message.body)
          : undefined
      if (segments) {
        totalSegments += segments.segments
      }
      if (index < PREVIEW_SAMPLE_SIZE) {
        samples.push({
          contactId: String(member.contact._id),
          contactName: member.contact.name,
          recipient: member.recipient,
          subject: message.subject,
          body: message.body,
          missingTags: message.missing,
          segments,
        })
      }
    })

    if (missingTags.size) {
      warnings.push(
        `Merge tags with no value for some contacts: ${[...missingTags].join(', ')}`,
      )
    }
    if (audience.eligible.length === 0) {
      warnings.push('Nobody on this list is eligible to receive the campaign')
    }

    const windowOpenNow = isInsideSendWindow(now, pacing)
    const opening = nextWindowOpening(now, pacing)
    const estimatedDurationMs =
      opening.getTime() -
      now.getTime() +
      estimateSendDurationMs(audience.eligible.length, pacing)
    if (!windowOpenNow) {
      warnings.push(
        `Send window is closed; sending would begin at ${opening.toISOString()}`,
      )
    }

    const isSms = campaign.channel === Channel.SMS
    return {
      campaignId: campaign._id.toString(),
      channel: campaign.channel,
      audienceSize: audience.eligible.length + audience.skipped.length,
      eligibleCount: audience.eligible.length,
      skippedCount: audience.skipped.length,
      skippedByReason: summarizeSkips(audience.skipped),
      samples,
      segmentsPerMessage: isSms ? samples[0]?.segments?.segments : undefined,
      totalSegments: isSms ? totalSegments : undefined,
      estimatedDurationMs,
      estimatedCompletionAt: new Date(
        now.getTime() + estimatedDurationMs,
      ).toISOString(),
      windowOpenNow,
      nextWindowOpeningAt: opening.toISOString(),
      warnings,
    }
  }

  // ----------------------------------------------------------- lifecycle

  async startCampaign(id: string, user: User): Promise<CampaignDocument> {
    const campaign = await this.getCampaignById(id, user)
    if (
      campaign.status !== CampaignStatus.DRAFT &&
      campaign.status !== CampaignStatus.SCHEDULED
    ) {
      throw new HttpException(
        {
          error: `Campaign is ${campaign.status}; only a draft can be started`,
        },
        HttpStatus.CONFLICT,
      )
    }
    this.assertChannelInputs(campaign.channel, campaign.device?.toString())

    const template = await this.loadTemplate(campaign, user)
    if (template.channel !== campaign.channel) {
      throw new HttpException(
        {
          error: `Template is for ${template.channel} but the campaign is ${campaign.channel}`,
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const audience = await this.loadAudience(campaign, user)
    const now = new Date()
    const base = {
      user: user._id,
      campaign: campaign._id,
      channel: campaign.channel,
      lane: SendLane.MARKETING,
    }

    const skippedRows = audience.skipped.map((member) => ({
      ...base,
      contact: member.contact._id,
      // `recipient` is required; fall back to whatever address we do have so
      // the report can still name the row.
      recipient:
        member.recipient ??
        member.contact.phone ??
        member.contact.email ??
        'unknown',
      status: SendStatus.SKIPPED,
      skipReason: member.reason,
    }))

    const queuedRows = audience.eligible.map((member) => {
      const message = renderCampaignMessage({
        template,
        contact: member.contact,
        channel: campaign.channel,
      })
      return {
        ...base,
        contact: member.contact._id,
        recipient: member.recipient,
        subject: message.subject,
        renderedBody: message.body,
        status: SendStatus.QUEUED,
        queuedAt: now,
        attempts: 0,
      }
    })

    if (skippedRows.length) {
      await this.sendModel.insertMany(skippedRows, { ordered: false })
    }
    const created = queuedRows.length
      ? await this.sendModel.insertMany(queuedRows, { ordered: false })
      : []

    const nothingToSend = created.length === 0
    await this.campaignModel
      .updateOne(
        { _id: campaign._id },
        {
          $set: {
            status: nothingToSend
              ? CampaignStatus.COMPLETED
              : CampaignStatus.SENDING,
            startedAt: now,
            completedAt: nothingToSend ? now : null,
            error: null,
          },
        },
      )
      .exec()

    if (!nothingToSend) {
      await this.enqueueSends(
        campaign._id.toString(),
        created.map((doc) => doc._id.toString()),
        this.pacingOf(campaign),
        now,
      )
    }

    await this.recomputeStats(campaign._id)
    this.logger.log(
      `Campaign ${campaign._id} started: ${created.length} queued, ${skippedRows.length} skipped`,
    )
    return await this.getCampaignById(id, user)
  }

  async pauseCampaign(id: string, user: User): Promise<CampaignDocument> {
    const campaign = await this.getCampaignById(id, user)
    if (campaign.status !== CampaignStatus.SENDING) {
      throw new HttpException(
        {
          error: `Campaign is ${campaign.status}; only a sending campaign can be paused`,
        },
        HttpStatus.CONFLICT,
      )
    }
    await this.campaignModel
      .updateOne(
        { _id: campaign._id },
        { $set: { status: CampaignStatus.PAUSED } },
      )
      .exec()
    await this.removePendingJobs(campaign._id.toString())
    await this.recomputeStats(campaign._id)
    return await this.getCampaignById(id, user)
  }

  async resumeCampaign(id: string, user: User): Promise<CampaignDocument> {
    const campaign = await this.getCampaignById(id, user)
    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new HttpException(
        {
          error: `Campaign is ${campaign.status}; only a paused campaign can be resumed`,
        },
        HttpStatus.CONFLICT,
      )
    }

    const queued = await this.sendModel
      .find({ campaign: campaign._id, status: SendStatus.QUEUED }, { _id: 1 })
      .sort({ _id: 1 })
      .lean()
      .exec()

    const now = new Date()
    const nothingLeft = queued.length === 0
    await this.campaignModel
      .updateOne(
        { _id: campaign._id },
        {
          $set: nothingLeft
            ? { status: CampaignStatus.COMPLETED, completedAt: now }
            : { status: CampaignStatus.SENDING },
        },
      )
      .exec()

    if (!nothingLeft) {
      await this.enqueueSends(
        campaign._id.toString(),
        queued.map((doc) => doc._id.toString()),
        this.pacingOf(campaign),
        now,
      )
    }
    await this.recomputeStats(campaign._id)
    return await this.getCampaignById(id, user)
  }

  async cancelCampaign(id: string, user: User): Promise<CampaignDocument> {
    const campaign = await this.getCampaignById(id, user)
    if (this.isTerminal(campaign.status)) {
      throw new HttpException(
        { error: `Campaign is already ${campaign.status}` },
        HttpStatus.CONFLICT,
      )
    }

    // Flip the status first so any job already in a worker's hands stops.
    const now = new Date()
    await this.campaignModel
      .updateOne(
        { _id: campaign._id },
        {
          $set: {
            status: CampaignStatus.FAILED,
            error: 'Cancelled by user',
            completedAt: now,
          },
        },
      )
      .exec()
    await this.removePendingJobs(campaign._id.toString())
    await this.sendModel
      .updateMany(
        { campaign: campaign._id, status: SendStatus.QUEUED },
        {
          $set: {
            status: SendStatus.FAILED,
            failedAt: now,
            errorCode: 'campaign_cancelled',
            errorMessage: 'Campaign cancelled before dispatch',
          },
        },
      )
      .exec()
    await this.recomputeStats(campaign._id)
    return await this.getCampaignById(id, user)
  }

  // -------------------------------------------------------------- report

  async getCampaignReport(id: string, user: User): Promise<CampaignReport> {
    const campaign = await this.getCampaignById(id, user)

    const byStatus: Array<{ _id: SendStatus; count: number }> =
      await this.sendModel.aggregate([
        { $match: { campaign: campaign._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
    const byReason: Array<{ _id: string; count: number }> =
      await this.sendModel.aggregate([
        { $match: { campaign: campaign._id, status: SendStatus.SKIPPED } },
        { $group: { _id: '$skipReason', count: { $sum: 1 } } },
      ])

    const totals = Object.values(SendStatus).reduce(
      (acc, status) => {
        acc[status] = 0
        return acc
      },
      { total: 0 } as CampaignReport['totals'],
    )
    for (const row of byStatus) {
      totals[row._id] = row.count
      totals.total += row.count
    }

    const skippedByReason = Object.values(SkipReason).reduce(
      (acc, reason) => {
        acc[reason] = 0
        return acc
      },
      {} as Record<SkipReason, number>,
    )
    for (const row of byReason) {
      if (row._id) {
        skippedByReason[row._id] = row.count
      }
    }

    const failedRows = await this.sendModel
      .find({ campaign: campaign._id, status: SendStatus.FAILED })
      .sort({ failedAt: -1, _id: -1 })
      .limit(REPORT_FAILURE_LIMIT)
      .populate({ path: 'contact', select: '_id name' })
      .lean()
      .exec()

    const failures = failedRows.map((row: any) => ({
      sendId: String(row._id),
      contact: row.contact
        ? {
            id: String(row.contact._id ?? row.contact),
            name: row.contact.name,
          }
        : null,
      recipient: row.recipient,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      attempts: row.attempts ?? 0,
      failedAt: row.failedAt,
    }))

    return {
      campaign: {
        id: campaign._id.toString(),
        name: campaign.name,
        channel: campaign.channel,
        status: campaign.status,
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt,
        error: campaign.error,
        stats: campaign.stats,
      },
      totals,
      skippedByReason,
      failures,
    }
  }

  // ------------------------------------------------------------- helpers

  /**
   * Rebuilds `campaign.stats` from the Send rows. The processor keeps the
   * counters in step with $inc; this is the reconciliation after any bulk
   * change so the numbers can never drift for long.
   */
  async recomputeStats(campaignId: Types.ObjectId | string): Promise<void> {
    const _id =
      typeof campaignId === 'string'
        ? new Types.ObjectId(campaignId)
        : campaignId
    const rows: Array<{
      _id: { status: SendStatus; skipReason?: string }
      count: number
    }> = await this.sendModel.aggregate([
      { $match: { campaign: _id } },
      {
        $group: {
          _id: { status: '$status', skipReason: '$skipReason' },
          count: { $sum: 1 },
        },
      },
    ])

    const stats = {
      picked: 0,
      queued: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      skipped: 0,
      skippedByReason: {} as Record<string, number>,
    }
    for (const row of rows) {
      stats.picked += row.count
      switch (row._id.status) {
        case SendStatus.QUEUED:
          stats.queued += row.count
          break
        case SendStatus.SENT:
          stats.sent += row.count
          break
        case SendStatus.DELIVERED:
          stats.delivered += row.count
          break
        case SendStatus.FAILED:
          stats.failed += row.count
          break
        case SendStatus.SKIPPED:
          stats.skipped += row.count
          if (row._id.skipReason) {
            stats.skippedByReason[row._id.skipReason] =
              (stats.skippedByReason[row._id.skipReason] ?? 0) + row.count
          }
          break
      }
    }
    await this.campaignModel.updateOne({ _id }, { $set: { stats } }).exec()
  }

  /** Resolves who on the campaign's list gets a message, and why others do not. */
  private async loadAudience(
    campaign: Campaign,
    user: User,
  ): Promise<ResolvedAudience<LeanContact>> {
    if (!campaign.list) {
      throw new HttpException(
        { error: 'Campaign has no contact list' },
        HttpStatus.BAD_REQUEST,
      )
    }
    const listId = (campaign.list as Types.ObjectId).toString()
    const memberIds = await this.listsService.resolveListMemberIds(listId, user)
    const contacts: LeanContact[] = memberIds.length
      ? await this.contactModel
          .find({ _id: { $in: memberIds }, user: user._id })
          .sort({ _id: 1 })
          .lean()
          .exec()
      : []

    const candidates = contacts
      .map((contact) => recipientForChannel(contact, campaign.channel))
      .filter((value): value is string => Boolean(value))
    const suppressed = candidates.length
      ? await this.suppressionService.filterSuppressed(
          candidates,
          campaign.channel,
          user,
        )
      : new Set<string>()

    const alreadySent: string[] = await this.sendModel.distinct('recipient', {
      campaign: campaign._id,
      status: {
        $in: [SendStatus.QUEUED, SendStatus.SENT, SendStatus.DELIVERED],
      },
    })

    return resolveAudience<LeanContact>({
      contacts,
      channel: campaign.channel,
      suppressed,
      alreadySentRecipients: alreadySent,
    })
  }

  private async loadTemplate(
    campaign: Campaign,
    user: User,
  ): Promise<MessageTemplate> {
    const template = campaign.template
      ? await this.templateModel
          .findOne({ _id: campaign.template, user: user._id })
          .lean()
          .exec()
      : null
    if (!template) {
      throw new HttpException(
        { error: 'Campaign template not found' },
        HttpStatus.NOT_FOUND,
      )
    }
    return template as MessageTemplate
  }

  private async enqueueSends(
    campaignId: string,
    sendIds: string[],
    pacing: PacingConfig,
    now: Date,
  ): Promise<void> {
    const jobs = sendIds.map((sendId, index) => ({
      data: { sendId, campaignId } as SendJobData,
      opts: {
        jobId: sendId,
        delay: computeScheduledDelayMs(index, pacing, now),
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    }))
    // Bull accepts large bulks but Redis pipelines are happier in chunks.
    const CHUNK = 500
    for (let i = 0; i < jobs.length; i += CHUNK) {
      await this.sendQueue.addBulk(jobs.slice(i, i + CHUNK))
    }
  }

  /** Drops every not-yet-running job that belongs to `campaignId`. */
  private async removePendingJobs(campaignId: string): Promise<number> {
    let removed = 0
    try {
      const jobs = await this.sendQueue.getJobs([
        'delayed',
        'waiting',
        'paused',
      ])
      for (const job of jobs) {
        if (job?.data?.campaignId !== campaignId) {
          continue
        }
        try {
          await job.remove()
          removed++
        } catch (e) {
          // A job that just became active cannot be removed; the processor
          // re-reads the campaign status and leaves it QUEUED.
          this.logger.debug(`Could not remove job ${job.id}: ${e?.message}`)
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to list queue jobs: ${e?.message}`)
    }
    return removed
  }

  private pacingOf(campaign: Campaign): PacingConfig {
    const stored: Partial<PacingConfig> = campaign.pacing
      ? typeof (campaign.pacing as any).toObject === 'function'
        ? (campaign.pacing as any).toObject()
        : campaign.pacing
      : {}
    return { ...DEFAULT_PACING, ...stored }
  }

  private isTerminal(status: CampaignStatus): boolean {
    return (
      status === CampaignStatus.COMPLETED || status === CampaignStatus.FAILED
    )
  }

  private assertChannelInputs(channel: Channel, device?: string | null): void {
    if (channel === Channel.SMS && !device) {
      throw new HttpException(
        { error: 'An SMS campaign needs a sending device' },
        HttpStatus.BAD_REQUEST,
      )
    }
  }
}
