import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateContactInputDTO {
  @ApiPropertyOptional({ type: String, example: 'Asha Shrestha' })
  name?: string

  @ApiPropertyOptional({
    type: String,
    description:
      'Phone number in any human form; stored as E.164. At least one of phone or email is required.',
    example: '+9779801234567',
  })
  phone?: string

  @ApiPropertyOptional({
    type: String,
    description: 'Email address; stored lowercased.',
    example: 'asha@example.com',
  })
  email?: string

  @ApiPropertyOptional({
    type: String,
    description:
      'Country calling code (digits only, no +) applied to phone numbers written in local form.',
    example: '977',
  })
  defaultCountryCode?: string

  @ApiPropertyOptional({ type: [String], example: ['vip', 'kathmandu'] })
  tags?: string[]

  @ApiPropertyOptional({
    type: Object,
    description: 'Arbitrary merge-tag values.',
    example: { shop_name: 'Your Shop' },
  })
  attributes?: Record<string, string>

  @ApiPropertyOptional({ type: Boolean, default: false })
  smsConsent?: boolean

  @ApiPropertyOptional({ type: Boolean, default: false })
  emailConsent?: boolean

  @ApiPropertyOptional({
    type: String,
    description:
      "Where consent came from, e.g. 'web-form', 'pos', 'manual'. Required for consent to be recorded.",
    example: 'manual',
  })
  consentSource?: string
}

export class UpdateContactInputDTO {
  @ApiPropertyOptional({ type: String })
  name?: string

  @ApiPropertyOptional({
    type: String,
    description: 'Phone number in any human form; stored as E.164.',
  })
  phone?: string

  @ApiPropertyOptional({ type: String })
  email?: string

  @ApiPropertyOptional({ type: String, example: '977' })
  defaultCountryCode?: string

  @ApiPropertyOptional({ type: [String] })
  tags?: string[]

  @ApiPropertyOptional({ type: Object })
  attributes?: Record<string, string>

  @ApiPropertyOptional({ type: Boolean })
  smsConsent?: boolean

  @ApiPropertyOptional({ type: Boolean })
  emailConsent?: boolean

  @ApiPropertyOptional({ type: String })
  consentSource?: string

  @ApiPropertyOptional({
    type: Boolean,
    description: 'true marks the contact as opted out now; false clears it.',
  })
  optedOut?: boolean
}

export class ListContactsQueryDTO {
  @ApiPropertyOptional({
    type: String,
    description: 'Case-insensitive match against name, phone and email.',
  })
  search?: string

  @ApiPropertyOptional({
    type: String,
    description: 'Only contacts with this tag.',
  })
  tag?: string

  @ApiPropertyOptional({
    type: String,
    enum: ['sms', 'email', 'any', 'none'],
    description:
      "Filter by consent: 'sms', 'email', 'any' (either) or 'none' (neither).",
  })
  consent?: string

  @ApiPropertyOptional({ type: Number, default: 1 })
  page?: number

  @ApiPropertyOptional({ type: Number, default: 25, description: 'Max 100.' })
  limit?: number
}

export class ImportContactsInputDTO {
  @ApiProperty({
    type: String,
    description:
      'CSV text with a header row. Recognised columns: name/full_name/first_name (+last_name), phone/mobile/number, email/email_address, tags, consent. Any other column is stored as an attribute.',
    example: 'name,phone,email,tags\nAsha,9801234567,asha@example.com,vip',
  })
  csv: string

  @ApiPropertyOptional({
    type: String,
    description:
      'Country calling code (digits only, no +) applied to phone numbers written in local form. Without it, local-form numbers are skipped.',
    example: '977',
  })
  defaultCountryCode?: string

  @ApiPropertyOptional({
    type: String,
    description:
      "Where consent for every row in this file came from, e.g. 'csv:march-list'. When supplied, consent is recorded for every imported contact.",
    example: 'csv:march-list',
  })
  consentSource?: string

  @ApiPropertyOptional({
    type: [String],
    description: 'Tags added to every imported contact.',
    example: ['march-import'],
  })
  tags?: string[]
}

export class ContactResponseDTO {
  @ApiProperty({ type: String })
  _id: string

  @ApiProperty({ type: String })
  name: string

  @ApiPropertyOptional({ type: String })
  phone?: string

  @ApiPropertyOptional({ type: String })
  email?: string

  @ApiProperty({ type: [String] })
  tags: string[]

  @ApiProperty({ type: Object })
  attributes: Record<string, string>

  @ApiProperty({ type: Boolean })
  smsConsent: boolean

  @ApiProperty({ type: Boolean })
  emailConsent: boolean

  @ApiPropertyOptional({ type: String })
  consentSource?: string

  @ApiPropertyOptional({ type: Date })
  consentAt?: Date

  @ApiPropertyOptional({ type: Date })
  optedOutAt?: Date

  @ApiPropertyOptional({ type: Date })
  lastMessagedAt?: Date

  @ApiProperty({ type: Date })
  createdAt: Date

  @ApiProperty({ type: Date })
  updatedAt: Date
}

export class PaginationMetaDTO {
  @ApiProperty({ type: Number })
  page: number

  @ApiProperty({ type: Number })
  limit: number

  @ApiProperty({ type: Number })
  total: number

  @ApiProperty({ type: Number })
  totalPages: number
}

export class ListContactsResponseDTO {
  @ApiProperty({ type: [ContactResponseDTO] })
  data: ContactResponseDTO[]

  @ApiProperty({ type: PaginationMetaDTO })
  meta: PaginationMetaDTO
}

export class ImportContactsSummaryDTO {
  @ApiProperty({ type: Number })
  created: number

  @ApiProperty({ type: Number })
  updated: number

  @ApiProperty({ type: Number })
  skipped: number

  @ApiProperty({
    type: Object,
    description: 'Count of skipped rows by reason.',
    example: { invalid_phone: 2, duplicate_in_file: 1 },
  })
  skippedReasons: Record<string, number>
}
