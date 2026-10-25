import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Send, SendDocument } from '../campaigns/schemas/send.schema'
import {
  MessageTemplate,
  MessageTemplateDocument,
} from '../templates/schemas/template.schema'
import {
  Channel,
  SendLane,
  SendStatus,
  SkipReason,
} from '../sendline/sendline.enums'
import {
  normalizeEmailAddress,
  normalizePhoneNumber,
} from '../contacts/phone-number-normalization'
import { renderTemplate } from '../templates/merge-tag-rendering'
import { SuppressionService } from '../suppression/suppression.service'
import { GatewayService } from '../gateway/gateway.service'
import { EmailService } from '../email/email.service'
import { User } from '../users/schemas/user.schema'

export interface SendMessageInput {
  channel: Channel
  to: string
  template?: string
  body?: string
  subject?: string
  vars?: Record<string, unknown>
  lane?: SendLane
  deviceId?: string
}

export interface SendMessageResult {
  id: string
  status: SendStatus
  renderedPreview: string
  skipReason?: string
  providerId?: string
}

interface ResolvedMessage {
  body: string
  subject?: string
}

const badRequest = (error: string, extra: Record<string, unknown> = {}) =>
  new HttpException({ error, ...extra }, HttpStatus.BAD_REQUEST)

/**
 * The transactional lane: "attach Sendline to any app".
 *
 * An order confirmation must never wait behind 400 promos, so this path has
 * no queue, no pacing and no quiet hours. What it does NOT skip is consent:
 * the suppression list is checked on every send, because a person who
 * replied STOP meant it regardless of what we call the message.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name)

  constructor(
    @InjectModel(Send.name) private readonly sendModel: Model<SendDocument>,
    @InjectModel(MessageTemplate.name)
    private readonly templateModel: Model<MessageTemplateDocument>,
    private readonly suppressionService: SuppressionService,
    private readonly gatewayService: GatewayService,
    private readonly emailService: EmailService,
  ) {}

  async sendMessage(
    input: SendMessageInput,
    user: User,
  ): Promise<SendMessageResult> {
    const channel = this.resolveChannel(input.channel)
    const lane = this.resolveLane(input.lane)
    const recipient = this.normalizeRecipient(input.to, channel)
    const { body, subject } = await this.resolveMessage(input, channel, user)

    // Consent is never skipped. Pacing is.
    const suppressed = await this.suppressionService.isSuppressed(
      recipient,
      channel,
      user,
    )
    if (suppressed) {
      const skipped = await this.sendModel.create({
        user: user._id,
        channel,
        lane,
        recipient,
        subject,
        renderedBody: body,
        status: SendStatus.SKIPPED,
        skipReason: SkipReason.SUPPRESSED,
        attempts: 0,
      })
      return {
        id: skipped._id.toString(),
        status: SendStatus.SKIPPED,
        skipReason: SkipReason.SUPPRESSED,
        renderedPreview: body,
      }
    }

    // The row goes in before the dispatch so a crash mid-send still leaves
    // evidence that we tried, instead of a message that officially never was.
    const send = await this.sendModel.create({
      user: user._id,
      channel,
      lane,
      recipient,
      subject,
      renderedBody: body,
      status: SendStatus.QUEUED,
      queuedAt: new Date(),
      attempts: 1,
    })
    const id = send._id.toString()

    try {
      const providerId =
        channel === Channel.SMS
          ? await this.dispatchSms(recipient, body, input.deviceId, user)
          : await this.dispatchEmail(recipient, subject, body)

      await this.sendModel.findByIdAndUpdate(send._id, {
        $set: { status: SendStatus.SENT, sentAt: new Date(), providerId },
      })

      return {
        id,
        status: SendStatus.SENT,
        renderedPreview: body,
        providerId,
      }
    } catch (e) {
      const errorMessage = this.describeError(e)
      this.logger.warn(
        `Transactional ${channel} to ${recipient} failed: ${errorMessage}`,
      )
      await this.sendModel.findByIdAndUpdate(send._id, {
        $set: {
          status: SendStatus.FAILED,
          failedAt: new Date(),
          errorMessage,
          errorCode:
            e instanceof HttpException ? String(e.getStatus()) : undefined,
        },
      })
      throw new HttpException(
        {
          error: `Failed to send ${channel}: ${errorMessage}`,
          id,
          status: SendStatus.FAILED,
        },
        HttpStatus.BAD_GATEWAY,
      )
    }
  }

  private resolveChannel(channel: unknown): Channel {
    if (channel === Channel.SMS || channel === Channel.EMAIL) return channel
    throw badRequest(
      `channel must be one of ${Object.values(Channel).join(', ')}`,
    )
  }

  private resolveLane(lane: unknown): SendLane {
    if (
      lane === undefined ||
      lane === null ||
      lane === SendLane.TRANSACTIONAL
    ) {
      return SendLane.TRANSACTIONAL
    }
    if (lane === SendLane.MARKETING) {
      throw badRequest(
        'Marketing messages are paced and must be sent through a campaign; this endpoint only accepts lane "transactional"',
      )
    }
    throw badRequest(`lane must be "${SendLane.TRANSACTIONAL}"`)
  }

  private normalizeRecipient(to: unknown, channel: Channel): string {
    if (typeof to !== 'string' || to.trim() === '') {
      throw badRequest('"to" is required')
    }
    if (channel === Channel.SMS) {
      const phone = normalizePhoneNumber(to)
      if (!phone) {
        throw badRequest(
          `"${to}" is not a usable phone number. Use E.164: a leading "+", the country code, then the number, e.g. +9779812345678`,
        )
      }
      return phone
    }
    const email = normalizeEmailAddress(to)
    if (!email) {
      throw badRequest(`"${to}" is not a valid email address`)
    }
    return email
  }

  private async resolveMessage(
    input: SendMessageInput,
    channel: Channel,
    user: User,
  ): Promise<ResolvedMessage> {
    const hasBody = typeof input.body === 'string' && input.body.trim() !== ''
    const hasTemplate =
      typeof input.template === 'string' && input.template.trim() !== ''

    if (hasBody && hasTemplate) {
      throw badRequest('Provide either "body" or "template", not both')
    }
    if (!hasBody && !hasTemplate) {
      throw badRequest('Provide either an inline "body" or a "template" slug')
    }

    let rawBody: string
    let rawSubject: string | undefined = input.subject

    if (hasTemplate) {
      const slug = input.template.trim()
      const template = await this.templateModel.findOne({
        user: user._id,
        slug,
      })
      if (!template) {
        throw new HttpException(
          { error: `No template with slug "${slug}"` },
          HttpStatus.NOT_FOUND,
        )
      }
      if (template.channel !== channel) {
        throw badRequest(
          `Template "${slug}" is a ${template.channel} template and cannot be sent as ${channel}`,
        )
      }
      rawBody = template.body
      rawSubject = rawSubject ?? template.subject
    } else {
      rawBody = input.body
    }

    const vars = input.vars ?? {}
    const rendered = renderTemplate(rawBody, vars)
    const missing = [...rendered.missing]

    let subject: string | undefined
    if (channel === Channel.EMAIL) {
      if (typeof rawSubject !== 'string' || rawSubject.trim() === '') {
        throw badRequest(
          'Email requires a "subject" (inline or from the template)',
        )
      }
      const renderedSubject = renderTemplate(rawSubject, vars)
      subject = renderedSubject.text.trim()
      for (const tag of renderedSubject.missing) {
        if (!missing.includes(tag)) missing.push(tag)
      }
    }

    if (missing.length > 0) {
      // Transactional messages carry facts (order numbers, codes). A blank
      // where a fact should be is worse than no message, so refuse.
      throw badRequest(
        `Message references merge tags with no value in "vars": ${missing.join(', ')}`,
        { missing },
      )
    }

    const body = rendered.text
    if (body.trim() === '') {
      throw badRequest('Message body is empty after rendering')
    }

    return { body, subject }
  }

  private async dispatchSms(
    recipient: string,
    body: string,
    deviceId: string | undefined,
    user: User,
  ): Promise<string | undefined> {
    const device = await this.resolveDevice(deviceId, user)
    const response = await this.gatewayService.sendSMS(device._id.toString(), {
      message: body,
      recipients: [recipient],
      smsBody: body,
      receivers: [recipient],
    })
    // Queue mode answers { smsBatchId }, direct mode a Firebase BatchResponse.
    return (
      response?.smsBatchId?.toString() ??
      response?.responses?.[0]?.messageId ??
      undefined
    )
  }

  /**
   * GatewayService.sendSMS trusts its caller about device ownership (the
   * gateway controller checks it with a guard), so the check lives here.
   */
  private async resolveDevice(
    deviceId: string | undefined,
    user: User,
  ): Promise<{ _id: Types.ObjectId }> {
    const userId = user._id.toString()

    if (deviceId) {
      if (!Types.ObjectId.isValid(deviceId)) {
        throw badRequest(`"${deviceId}" is not a valid device id`)
      }
      const device = await this.gatewayService.getDeviceById(deviceId)
      if (!device || String(device.user?._id ?? device.user) !== userId) {
        throw new HttpException(
          { error: `No device with id "${deviceId}"` },
          HttpStatus.NOT_FOUND,
        )
      }
      if (!device.enabled) {
        throw badRequest(`Device "${deviceId}" is disabled`)
      }
      return device
    }

    const devices = await this.gatewayService.getDevicesForUser(user)
    const enabled = (devices ?? []).find((d) => d.enabled)
    if (!enabled) {
      throw badRequest(
        'No enabled device to send SMS from. Register and enable a device, or pass "deviceId"',
      )
    }
    return enabled
  }

  private async dispatchEmail(
    recipient: string,
    subject: string,
    body: string,
  ): Promise<string> {
    const { messageId } = await this.emailService.sendEmail({
      to: recipient,
      subject,
      body,
    })
    return messageId
  }

  private describeError(e: unknown): string {
    if (e instanceof HttpException) {
      const response = e.getResponse()
      if (typeof response === 'string') return response
      const error = (response as Record<string, unknown>)?.error
      if (typeof error === 'string') return error
      return e.message
    }
    if (e instanceof Error) return e.message
    return String(e)
  }
}
