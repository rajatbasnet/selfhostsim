import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Channel } from '../sendline/sendline.enums'

export class CreateTemplateDTO {
  @ApiProperty({ type: String, required: true, example: 'Order shipped' })
  name: string

  @ApiPropertyOptional({
    type: String,
    description:
      'Stable machine name, unique per user. Lowercase letters, digits, - and _.',
    example: 'order-shipped',
  })
  slug?: string

  @ApiProperty({ enum: Channel, required: true, example: Channel.SMS })
  channel: Channel

  @ApiPropertyOptional({
    type: String,
    description: 'Required for email templates, ignored for SMS.',
    example: 'Your order {{order_id}} has shipped',
  })
  subject?: string

  @ApiProperty({
    type: String,
    required: true,
    description: 'Message body with {{merge_tags}}.',
    example: 'Hi {{first_name}}, your order {{order_id}} is on its way.',
  })
  body: string
}

export class UpdateTemplateDTO {
  @ApiPropertyOptional({ type: String })
  name?: string

  @ApiPropertyOptional({ type: String })
  slug?: string

  @ApiPropertyOptional({ enum: Channel })
  channel?: Channel

  @ApiPropertyOptional({ type: String })
  subject?: string

  @ApiPropertyOptional({ type: String })
  body?: string
}

export class PreviewTemplateDTO {
  @ApiPropertyOptional({
    type: Object,
    description: 'Merge-tag values, e.g. { first_name: "Ada" }.',
    example: { first_name: 'Ada', attributes: { shop_name: 'Your Shop' } },
  })
  vars?: Record<string, unknown>
}

export class SmsSegmentCountDTO {
  @ApiProperty({ enum: ['GSM-7', 'UCS-2'] })
  encoding: 'GSM-7' | 'UCS-2'

  @ApiProperty({ type: Number })
  characters: number

  @ApiProperty({ type: Number })
  segments: number
}

export class TemplatePreviewDTO {
  @ApiProperty({ enum: Channel })
  channel: Channel

  @ApiPropertyOptional({ type: String, description: 'Email only.' })
  subject?: string

  @ApiProperty({ type: String, description: 'Rendered body.' })
  text: string

  @ApiProperty({
    type: [String],
    description:
      'Tags (body and subject) that had no value and rendered as empty.',
  })
  missing: string[]

  @ApiPropertyOptional({ type: SmsSegmentCountDTO, description: 'SMS only.' })
  segments?: SmsSegmentCountDTO
}
