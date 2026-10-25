import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { GATEWAY_SMS_RECEIVED_EVENT } from '../gateway/events/gateway.events'
import { Device, DeviceDocument } from '../gateway/schemas/device.schema'
import { SuppressionService } from '../suppression/suppression.service'

export interface GatewaySmsReceivedPayload {
  smsId: string
  deviceId: string
  sender: string
  message: string
  receivedAtInMillis: number
}

/**
 * Bridges the gateway to the opt-out layer.
 *
 * The gateway's job is to get an SMS off the phone and into Mongo; it should
 * not know what STOP means. This listener is the seam between the two, which
 * is why it lives in its own module rather than inside either of them.
 *
 * Speed matters here. This runs on every inbound message, and the gap between
 * someone replying STOP and us honouring it is the gap in which we might send
 * them another marketing message.
 */
@Injectable()
export class InboundSmsListener {
  private readonly logger = new Logger(InboundSmsListener.name)

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    private readonly suppressionService: SuppressionService,
  ) {}

  @OnEvent(GATEWAY_SMS_RECEIVED_EVENT, { async: true })
  async handleInboundSms(payload: GatewaySmsReceivedPayload): Promise<void> {
    try {
      // The event carries a device, not a user. Suppression is per-owner, so
      // we have to resolve the owner before we can suppress anything.
      const device = await this.deviceModel
        .findById(payload.deviceId)
        .select('user')
        .lean()

      if (!device?.user) {
        this.logger.warn(
          `Inbound SMS from an unowned device ${payload.deviceId}; cannot apply opt-out`,
        )
        return
      }

      const result = await this.suppressionService.handleInboundMessage(
        {
          sender: payload.sender,
          message: payload.message,
          deviceId: payload.deviceId,
        },
        device.user,
      )

      if (result?.action === 'suppressed') {
        this.logger.log(`Opt-out honoured for an inbound message`)
      }
    } catch (error) {
      // Never let this throw. An unhandled rejection here would take down the
      // listener for every subsequent message, and a missed opt-out is the
      // one failure in this system with legal consequences.
      this.logger.error(
        `Failed to process inbound SMS ${payload?.smsId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
