import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'
import { Channel, SuppressionReason } from '../../sendline/sendline.enums'

export type SuppressionDocument = Suppression & Document

/**
 * The do-not-contact list.
 *
 * This collection outranks every other table in the system. A CSV import, a
 * manual edit and a campaign audience can all be wrong; this one is treated as
 * correct. Entries are never removed by an import, only by an explicit,
 * deliberate delete.
 */
@Schema({ timestamps: true })
export class Suppression {
  _id?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: User.name, index: true })
  user: User | Types.ObjectId

  /** Normalised phone (E.164) or lowercased email. */
  @Prop({ type: String, required: true, index: true })
  value: string

  @Prop({ type: String, enum: Object.values(Channel), required: true })
  channel: Channel

  @Prop({
    type: String,
    enum: Object.values(SuppressionReason),
    default: SuppressionReason.STOP,
  })
  reason: SuppressionReason

  /** The inbound message that triggered this, when there was one. */
  @Prop({ type: String })
  evidence?: string

  createdAt?: Date
  updatedAt?: Date
}

export const SuppressionSchema = SchemaFactory.createForClass(Suppression)

SuppressionSchema.index({ user: 1, channel: 1, value: 1 }, { unique: true })
