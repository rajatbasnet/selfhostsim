import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator'
import { Channel, DEFAULT_PACING } from '../sendline/sendline.enums'

export class CampaignPacingDTO {
  @ApiPropertyOptional({
    type: Number,
    description: 'Messages released per minute',
    default: DEFAULT_PACING.ratePerMinute,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(600)
  ratePerMinute?: number

  @ApiPropertyOptional({
    type: Number,
    description:
      'Maximum marketing messages per local day. 0 disables the cap.',
    default: DEFAULT_PACING.dailyCap,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  dailyCap?: number

  @ApiPropertyOptional({
    type: Number,
    description: 'Local hour (0-24) at which sending may start, inclusive',
    default: DEFAULT_PACING.windowStartHour,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  windowStartHour?: number

  @ApiPropertyOptional({
    type: Number,
    description: 'Local hour (0-24) at which sending stops, exclusive',
    default: DEFAULT_PACING.windowEndHour,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  windowEndHour?: number

  @ApiPropertyOptional({
    type: String,
    description: "IANA zone or offset, e.g. 'Asia/Kathmandu' or '+05:45'",
    default: DEFAULT_PACING.timezone,
  })
  @IsOptional()
  @IsString()
  timezone?: string
}

export class CreateCampaignDTO {
  @ApiProperty({ type: String, example: 'Dashain sale' })
  @IsString()
  @MinLength(1)
  name: string

  @ApiProperty({ enum: Channel, example: Channel.SMS })
  @IsEnum(Channel)
  channel: Channel

  @ApiProperty({ type: String, description: 'MessageTemplate id' })
  @IsMongoId()
  template: string

  @ApiProperty({ type: String, description: 'ContactList id' })
  @IsMongoId()
  list: string

  @ApiPropertyOptional({
    type: String,
    description: 'Device id that sends the SMS. Required for SMS campaigns.',
  })
  @IsOptional()
  @IsMongoId()
  device?: string

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string

  @ApiPropertyOptional({ type: CampaignPacingDTO })
  @IsOptional()
  @IsObject()
  pacing?: CampaignPacingDTO
}

export class UpdateCampaignDTO extends PartialType(CreateCampaignDTO) {}

export class CampaignPreviewSampleDTO {
  @ApiProperty({ type: String })
  contactId: string

  @ApiProperty({ type: String })
  contactName: string

  @ApiProperty({ type: String })
  recipient: string

  @ApiPropertyOptional({ type: String })
  subject?: string

  @ApiProperty({ type: String })
  body: string

  @ApiProperty({ type: [String], description: 'Merge tags with no value' })
  missingTags: string[]

  @ApiPropertyOptional({
    description: 'SMS only: encoding, character and segment count',
  })
  segments?: { encoding: string; characters: number; segments: number }
}

export class CampaignPreviewDTO {
  @ApiProperty({ type: String })
  campaignId: string

  @ApiProperty({ enum: Channel })
  channel: Channel

  @ApiProperty({ type: Number, description: 'Contacts on the list' })
  audienceSize: number

  @ApiProperty({ type: Number, description: 'Contacts that will be sent to' })
  eligibleCount: number

  @ApiProperty({ type: Number })
  skippedCount: number

  @ApiProperty({ description: 'skippedCount broken down by SkipReason' })
  skippedByReason: Record<string, number>

  @ApiProperty({ type: [CampaignPreviewSampleDTO] })
  samples: CampaignPreviewSampleDTO[]

  @ApiPropertyOptional({
    type: Number,
    description: 'SMS only: segments per message for the first sample',
  })
  segmentsPerMessage?: number

  @ApiPropertyOptional({
    type: Number,
    description: 'SMS only: segments across the whole eligible audience',
  })
  totalSegments?: number

  @ApiProperty({ type: Number })
  estimatedDurationMs: number

  @ApiProperty({ type: String, format: 'date-time' })
  estimatedCompletionAt: string

  @ApiProperty({ type: Boolean })
  windowOpenNow: boolean

  @ApiProperty({ type: String, format: 'date-time' })
  nextWindowOpeningAt: string

  @ApiProperty({ type: [String] })
  warnings: string[]
}
