import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'

export type ContactDocument = Contact & Document

/**
 * A person we may contact.
 *
 * Consent is a first-class field with a source and a timestamp, not a boolean
 * somebody ticked once. If we cannot say where consent came from and when, we
 * do not have consent.
 */
@Schema({ timestamps: true })
export class Contact {
  _id?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: User.name, index: true })
  user: User | Types.ObjectId

  @Prop({ type: String, trim: true })
  name: string

  /** Canonical E.164, written by normalizePhoneNumber. Never raw user input. */
  @Prop({ type: String, index: true, sparse: true })
  phone?: string

  /** Lowercased, written by normalizeEmailAddress. */
  @Prop({ type: String, index: true, sparse: true })
  email?: string

  @Prop({ type: [String], default: [] })
  tags: string[]

  /** Arbitrary merge-tag values, e.g. { shop_name: 'Your Shop' }. */
  @Prop({ type: Object, default: {} })
  attributes: Record<string, string>

  @Prop({ type: Boolean, default: false })
  smsConsent: boolean

  @Prop({ type: Boolean, default: false })
  emailConsent: boolean

  /** Where consent came from: 'web-form', 'pos', 'csv:march-list', 'manual'. */
  @Prop({ type: String })
  consentSource?: string

  @Prop({ type: Date })
  consentAt?: Date

  /** Set when the person opted out. Presence alone disqualifies them. */
  @Prop({ type: Date })
  optedOutAt?: Date

  @Prop({ type: Date })
  lastMessagedAt?: Date

  createdAt?: Date
  updatedAt?: Date
}

export const ContactSchema = SchemaFactory.createForClass(Contact)

// Dedupe is per-owner, not global: two users may legitimately hold the same
// number.
//
// These MUST be partial, not sparse. On a COMPOUND index, `sparse` only skips
// a document that is missing every indexed field - and `user` is always
// present. So under `sparse` an email-only contact still gets indexed as
// { user, phone: null }, and the second email-only contact for the same user
// dies with E11000. A partial index keys only the documents where the field is
// actually a string, which is what was meant all along.
ContactSchema.index(
  { user: 1, phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
)
ContactSchema.index(
  { user: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
)
ContactSchema.index({ user: 1, tags: 1 })
