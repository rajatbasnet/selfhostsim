import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Channel, SuppressionReason } from '../sendline/sendline.enums'

export class CreateSuppressionDTO {
  @ApiProperty({
    type: String,
    required: true,
    description:
      'Phone number (any human format, normalised to E.164) or email address',
    example: '+9779841234567',
  })
  value: string

  @ApiProperty({ enum: Channel, required: true, example: Channel.SMS })
  channel: Channel

  @ApiPropertyOptional({
    enum: SuppressionReason,
    default: SuppressionReason.MANUAL,
    description: 'Why this entry exists. Manual additions default to "manual".',
  })
  reason?: SuppressionReason

  @ApiPropertyOptional({
    type: String,
    description: 'Free-text evidence, e.g. the complaint email or ticket id',
  })
  evidence?: string
}

export class ListSuppressionsQueryDTO {
  @ApiPropertyOptional({ enum: Channel })
  channel?: Channel

  @ApiPropertyOptional({ type: Number, default: 1 })
  page?: number

  @ApiPropertyOptional({ type: Number, default: 50, maximum: 200 })
  limit?: number
}

/** What the gateway posts when a device reports an inbound SMS. */
export class InboundMessageDTO {
  @ApiProperty({
    type: String,
    required: true,
    description: 'Sender address exactly as the handset reported it',
    example: '+9779841234567',
  })
  sender: string

  @ApiProperty({
    type: String,
    required: true,
    description: 'Raw message body, unmodified',
    example: 'STOP',
  })
  message: string

  @ApiPropertyOptional({
    type: String,
    description: 'Device that received the message',
  })
  deviceId?: string
}

export type InboundMessageAction = 'suppressed' | 'resubscribed' | 'inbox'

export class InboundMessageOutcomeDTO {
  @ApiProperty({ enum: ['suppressed', 'resubscribed', 'inbox'] })
  action: InboundMessageAction

  @ApiPropertyOptional({
    type: String,
    description:
      'Text the gateway should send back to the sender, when there is one',
  })
  confirmationReply?: string

  @ApiPropertyOptional({
    type: String,
    description: 'The sender in canonical form, when it could be normalised',
  })
  normalizedSender?: string

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Set on inbox messages that mention an opt-out word in a sentence, so a human looks at them first',
  })
  flaggedForReview?: boolean
}
