import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'
import { Contact } from '../../contacts/schemas/contact.schema'
import { Campaign } from './campaign.schema'
import { Channel, SendLane, SendStatus } from '../../sendline/sendline.enums'

export type SendDocument = Send & Document

/**
 * One row per recipient per campaign. The audit trail.
 *
 * `renderedBody` holds the exact text that was sent, not a reference to the
 * template. Templates get edited; if we kept only the id, every historical
 * report would start lying the moment someone fixed a typo.
 */
@Schema({ timestamps: true })
export class Send {
  _id?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: User.name, index: true })
  user: User | Types.ObjectId

  /** Absent for transactional sends, which belong to no campaign. */
  @Prop({ type: Types.ObjectId, ref: Campaign.name, index: true })
  campaign?: Campaign | Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: Contact.name, index: true })
  contact?: Contact | Types.ObjectId

  @Prop({ type: String, enum: Object.values(Channel), required: true })
  channel: Channel

  @Prop({
    type: String,
    enum: Object.values(SendLane),
    default: SendLane.MARKETING,
  })
  lane: SendLane

  /** Normalised phone or email this went to. */
  @Prop({ type: String, required: true })
  recipient: string

  @Prop({ type: String })
  subject?: string

  /** Exactly what the recipient saw. Never recomputed. */
  @Prop({ type: String })
  renderedBody?: string

  @Prop({
    type: String,
    enum: Object.values(SendStatus),
    default: SendStatus.QUEUED,
    index: true,
  })
  status: SendStatus

  /** Set when status is SKIPPED. One of SkipReason. */
  @Prop({ type: String })
  skipReason?: string

  /** The gateway's id for this message: the SMS _id, or the SMTP message id. */
  @Prop({ type: String, index: true, sparse: true })
  providerId?: string

  @Prop({ type: Date })
  queuedAt?: Date

  @Prop({ type: Date })
  sentAt?: Date

  @Prop({ type: Date })
  deliveredAt?: Date

  @Prop({ type: Date })
  failedAt?: Date

  @Prop({ type: String })
  errorCode?: string

  @Prop({ type: String })
  errorMessage?: string

  @Prop({ type: Number, default: 0 })
  attempts: number

  createdAt?: Date
  updatedAt?: Date
}

export const SendSchema = SchemaFactory.createForClass(Send)

// "have we already sent this campaign to this person" - the dedupe guard.
SendSchema.index({ campaign: 1, recipient: 1 }, { sparse: true })
SendSchema.index({ user: 1, createdAt: -1 })
SendSchema.index({ user: 1, status: 1, createdAt: -1 })
