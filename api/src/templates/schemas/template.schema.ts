import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'
import { Channel } from '../../sendline/sendline.enums'

export type MessageTemplateDocument = MessageTemplate & Document

/**
 * A reusable message body with {{merge_tags}}.
 *
 * Named MessageTemplate rather than Template because `Template` collides with
 * the DOM lib type that TypeScript pulls in, and the resulting errors are
 * baffling.
 */
@Schema({ timestamps: true })
export class MessageTemplate {
  _id?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: User.name, index: true })
  user: User | Types.ObjectId

  @Prop({ type: String, required: true, trim: true })
  name: string

  /** Stable machine name so other apps can POST { template: 'order-shipped' }. */
  @Prop({ type: String, index: true, sparse: true })
  slug?: string

  @Prop({ type: String, enum: Object.values(Channel), required: true })
  channel: Channel

  /** Email only; ignored for SMS. */
  @Prop({ type: String })
  subject?: string

  @Prop({ type: String, required: true })
  body: string

  createdAt?: Date
  updatedAt?: Date
}

export const MessageTemplateSchema =
  SchemaFactory.createForClass(MessageTemplate)

MessageTemplateSchema.index(
  { user: 1, slug: 1 },
  { unique: true, sparse: true },
)
