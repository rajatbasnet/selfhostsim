import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Channel, SendLane, SendStatus } from '../sendline/sendline.enums'

/**
 * POST /v1/messages - the body another application sends.
 *
 * Exactly one of `body` or `template` must be present.
 */
export class SendMessageInputDTO {
  @ApiProperty({
    enum: Channel,
    enumName: 'Channel',
    example: Channel.SMS,
    description:
      'Delivery channel. "sms" goes out through one of your registered Android devices; "email" through the configured SMTP server.',
  })
  channel: Channel

  @ApiProperty({
    type: String,
    example: '+9779812345678',
    description:
      'Recipient. For SMS a phone number in E.164 form (leading "+", country code, no spaces). For email an address. Normalised before sending; an address that cannot be normalised is rejected with 400.',
  })
  to: string

  @ApiPropertyOptional({
    type: String,
    example: 'order-confirmed',
    description:
      'Slug of one of your saved message templates. The template body (and, for email, its subject) is rendered with `vars`. Mutually exclusive with `body`.',
  })
  template?: string

  @ApiPropertyOptional({
    type: String,
    example: 'Hi {{name}}, your order {{order_id}} is confirmed.',
    description:
      'Inline message text. May contain {{merge_tags}} filled from `vars`. Mutually exclusive with `template`.',
  })
  body?: string

  @ApiPropertyOptional({
    type: String,
    example: 'Your order is confirmed',
    description:
      'Email subject. Required for email when no template is used; when a template is used this overrides the template subject. Ignored for SMS. May contain {{merge_tags}}.',
  })
  subject?: string

  @ApiPropertyOptional({
    type: Object,
    additionalProperties: true,
    example: { name: 'Asha', order_id: 'A-1042' },
    description:
      'Values for the {{merge_tags}} in the body and subject. Every tag referenced must have a value: a message with an unfilled tag is rejected with 400 rather than sent with a blank.',
  })
  vars?: Record<string, unknown>

  @ApiPropertyOptional({
    enum: SendLane,
    enumName: 'SendLane',
    default: SendLane.TRANSACTIONAL,
    description:
      'Only "transactional" is accepted here. Transactional messages are dispatched immediately, ahead of any campaign traffic, with no pacing or quiet hours. The do-not-contact list is still honoured. Marketing sends must go through campaigns, which pace them.',
  })
  lane?: SendLane

  @ApiPropertyOptional({
    type: String,
    example: '66f1c2a4e8b7d2a1c9f0e123',
    description:
      'SMS only. The id of the device that should send the message. Defaults to your first enabled device.',
  })
  deviceId?: string
}

export class SendMessageResultDTO {
  @ApiProperty({
    type: String,
    description:
      'Id of the ledger row for this message. Use it to look the send up later.',
  })
  id: string

  @ApiProperty({
    enum: SendStatus,
    enumName: 'SendStatus',
    description:
      '"sent" when the provider accepted the message; "skipped" when the recipient is on your do-not-contact list and nothing was sent.',
  })
  status: SendStatus

  @ApiProperty({
    type: String,
    description:
      'The exact text that was (or would have been) delivered, after merge tags were filled.',
  })
  renderedPreview: string

  @ApiPropertyOptional({
    type: String,
    example: 'suppressed',
    description:
      'Present when status is "skipped": why the recipient was dropped.',
  })
  skipReason?: string

  @ApiPropertyOptional({
    type: String,
    description: 'Provider reference: the SMS batch id or the SMTP Message-ID.',
  })
  providerId?: string
}

export class SendMessageResponseDTO {
  @ApiProperty({ type: SendMessageResultDTO })
  data: SendMessageResultDTO
}
