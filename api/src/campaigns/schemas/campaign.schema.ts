import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'
import { ContactList } from '../../lists/schemas/contact-list.schema'
import { MessageTemplate } from '../../templates/schemas/template.schema'
import { Device } from '../../gateway/schemas/device.schema'
import {
  CampaignStatus,
  Channel,
  DEFAULT_PACING,
} from '../../sendline/sendline.enums'

export type CampaignDocument = Campaign & Document

@Schema({ _id: false })
export class CampaignPacing {
  @Prop({ type: Number, default: DEFAULT_PACING.ratePerMinute })
  ratePerMinute: number

  @Prop({ type: Number, default: DEFAULT_PACING.dailyCap })
  dailyCap: number

  @Prop({ type: Number, default: DEFAULT_PACING.windowStartHour })
  windowStartHour: number

  @Prop({ type: Number, default: DEFAULT_PACING.windowEndHour })
  windowEndHour: number

  @Prop({ type: String, default: DEFAULT_PACING.timezone })
  timezone: string
}

@Schema({ _id: false })
export class CampaignStats {
  @Prop({ type: Number, default: 0 })
  picked: number

  @Prop({ type: Number, default: 0 })
  queued: number

  @Prop({ type: Number, default: 0 })
  sent: number

  @Prop({ type: Number, default: 0 })
  delivered: number

  @Prop({ type: Number, default: 0 })
  failed: number

  @Prop({ type: Number, default: 0 })
  skipped: number

  /** Breakdown of `skipped` by SkipReason, so a report can explain the drop. */
  @Prop({ type: Object, default: {} })
  skippedByReason: Record<string, number>
}

@Schema({ timestamps: true })
export class Campaign {
  _id?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: User.name, index: true })
  user: User | Types.ObjectId

  @Prop({ type: String, required: true, trim: true })
  name: string

  @Prop({ type: String, enum: Object.values(Channel), required: true })
  channel: Channel

  @Prop({ type: Types.ObjectId, ref: MessageTemplate.name })
  template: MessageTemplate | Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: ContactList.name })
  list?: ContactList | Types.ObjectId

  /** SMS only: which phone sends it. */
  @Prop({ type: Types.ObjectId, ref: Device.name })
  device?: Device | Types.ObjectId

  @Prop({
    type: String,
    enum: Object.values(CampaignStatus),
    default: CampaignStatus.DRAFT,
    index: true,
  })
  status: CampaignStatus

  @Prop({ type: Date })
  scheduledAt?: Date

  @Prop({ type: Date })
  startedAt?: Date

  @Prop({ type: Date })
  completedAt?: Date

  @Prop({ type: CampaignPacing, default: () => ({}) })
  pacing: CampaignPacing

  @Prop({ type: CampaignStats, default: () => ({}) })
  stats: CampaignStats

  @Prop({ type: String })
  error?: string

  createdAt?: Date
  updatedAt?: Date
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign)

CampaignSchema.index({ user: 1, status: 1, scheduledAt: 1 })
