import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'
import { Contact } from '../../contacts/schemas/contact.schema'
import { ContactListType } from '../../sendline/sendline.enums'

export type ContactListDocument = ContactList & Document

/**
 * A named audience.
 *
 * Static lists hold explicit contact ids. Dynamic lists hold a filter that is
 * re-evaluated every time the list is used, so "everyone tagged vip" stays
 * true as contacts change.
 */
@Schema({ timestamps: true })
export class ContactList {
  _id?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: User.name, index: true })
  user: User | Types.ObjectId

  @Prop({ type: String, required: true, trim: true })
  name: string

  @Prop({
    type: String,
    enum: Object.values(ContactListType),
    default: ContactListType.STATIC,
  })
  type: ContactListType

  /** Static lists only. */
  @Prop({ type: [{ type: Types.ObjectId, ref: Contact.name }], default: [] })
  contactIds: Types.ObjectId[]

  /**
   * Dynamic lists only. A narrow, explicit filter - never a raw Mongo query
   * from the client, which would be an injection hole.
   */
  @Prop({ type: Object, default: null })
  filter?: {
    tagsInclude?: string[]
    tagsExclude?: string[]
    hasPhone?: boolean
    hasEmail?: boolean
    smsConsent?: boolean
    emailConsent?: boolean
    createdAfter?: Date
    createdBefore?: Date
  } | null

  createdAt?: Date
  updatedAt?: Date
}

export const ContactListSchema = SchemaFactory.createForClass(ContactList)

ContactListSchema.index({ user: 1, name: 1 })
