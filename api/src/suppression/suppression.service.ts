import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Suppression, SuppressionDocument } from './schemas/suppression.schema'
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema'
import { User } from '../users/schemas/user.schema'
import { Channel, SuppressionReason } from '../sendline/sendline.enums'
import {
  normalizeEmailAddress,
  normalizePhoneNumber,
} from '../contacts/phone-number-normalization'
import {
  containsOptOutKeyword,
  isOptInMessage,
  isOptOutMessage,
} from './opt-out-keyword-matching'
import { InboundMessageDTO, InboundMessageOutcomeDTO } from './suppression.dto'

/** Reply sent exactly once in response to STOP. Permitted and expected. */
export const OPT_OUT_CONFIRMATION_REPLY =
  'You have been unsubscribed and will receive no further messages. Reply START to resubscribe.'

export const OPT_IN_CONFIRMATION_REPLY =
  'You are subscribed again. Reply STOP at any time to opt out.'

const MAX_EVIDENCE_LENGTH = 2000
const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 200
const MONGO_DUPLICATE_KEY = 11000

export interface ListSuppressionsOptions {
  channel?: Channel
  page?: number
  limit?: number
}

type UserRef = Pick<User, '_id'> | { _id: Types.ObjectId | string }

/**
 * The do-not-contact list, and the only code allowed to write to it.
 *
 * Every lookup goes through `lookupKeys`, which tries the canonical form of a
 * value AND its raw trimmed form, so an entry is found even when it had to be
 * stored un-normalised (see `handleInboundMessage`). Misses here send a real
 * message to someone who asked us not to, so when in doubt this service
 * errs towards "suppressed".
 */
@Injectable()
export class SuppressionService {
  constructor(
    @InjectModel(Suppression.name)
    private suppressionModel: Model<SuppressionDocument>,
    @InjectModel(Contact.name)
    private contactModel: Model<ContactDocument>,
  ) {}

  // ---------------------------------------------------------------------------
  // Normalisation helpers
  // ---------------------------------------------------------------------------

  /**
   * Country code applied to local-format numbers, from the same env var the
   * rest of the API uses. Read at call time so tests and deployments can
   * change it without a restart of module state.
   */
  private defaultCountryCode(): string | undefined {
    const raw = process.env.DEFAULT_PHONE_COUNTRY_CODE
    if (!raw) return undefined
    const digits = raw.replace(/\D/g, '')
    return digits || undefined
  }

  /**
   * Canonical form for a channel, or null when it cannot be produced with
   * confidence. Phones become E.164, emails become lowercased.
   */
  normalizeValue(value: string, channel: Channel): string | null {
    if (channel === Channel.SMS) {
      return normalizePhoneNumber(value, {
        defaultCountryCode: this.defaultCountryCode(),
      })
    }
    if (channel === Channel.EMAIL) {
      return normalizeEmailAddress(value)
    }
    return null
  }

  /** Raw-but-tidy fallback key: trimmed, and lowercased for email. */
  private rawKey(value: string, channel: Channel): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed) return null
    return channel === Channel.EMAIL ? trimmed.toLowerCase() : trimmed
  }

  /** Every string under which this value could have been stored. */
  private lookupKeys(value: string, channel: Channel): string[] {
    const keys = new Set<string>()
    const normalized = this.normalizeValue(value, channel)
    if (normalized) keys.add(normalized)
    const raw = this.rawKey(value, channel)
    if (raw) keys.add(raw)
    return [...keys]
  }

  private assertChannel(channel: Channel): void {
    if (!Object.values(Channel).includes(channel)) {
      throw new HttpException(
        { error: `Unknown channel "${channel}"` },
        HttpStatus.BAD_REQUEST,
      )
    }
  }

  private userId(user: UserRef): Types.ObjectId | string {
    return user._id
  }

  // ---------------------------------------------------------------------------
  // Read side (called by campaigns for every send)
  // ---------------------------------------------------------------------------

  /**
   * True when the value must not be contacted on this channel.
   * A value that is empty or cannot even be trimmed into a key is reported as
   * suppressed: we cannot prove it is safe, so it is not.
   */
  async isSuppressed(
    value: string,
    channel: Channel,
    user: UserRef,
  ): Promise<boolean> {
    this.assertChannel(channel)
    const keys = this.lookupKeys(value, channel)
    if (keys.length === 0) return true

    const hit = await this.suppressionModel
      .findOne(
        { user: this.userId(user), channel, value: { $in: keys } },
        { _id: 1 },
      )
      .lean()
    return !!hit
  }

  /**
   * Returns the subset of `values` (as the caller spelled them) that is
   * suppressed. One round trip regardless of input size: every candidate key
   * for every value goes into a single `$in`.
   */
  async filterSuppressed(
    values: string[],
    channel: Channel,
    user: UserRef,
  ): Promise<Set<string>> {
    this.assertChannel(channel)
    const suppressed = new Set<string>()
    if (!Array.isArray(values) || values.length === 0) return suppressed

    // key -> every original spelling that resolves to it
    const originalsByKey = new Map<string, string[]>()
    for (const original of values) {
      const keys = this.lookupKeys(original, channel)
      if (keys.length === 0) {
        // Unusable address: fail closed, same as isSuppressed.
        suppressed.add(original)
        continue
      }
      for (const key of keys) {
        const bucket = originalsByKey.get(key)
        if (bucket) bucket.push(original)
        else originalsByKey.set(key, [original])
      }
    }

    if (originalsByKey.size === 0) return suppressed

    const rows: Array<Pick<Suppression, 'value'>> = await this.suppressionModel
      .find(
        {
          user: this.userId(user),
          channel,
          value: { $in: [...originalsByKey.keys()] },
        },
        { value: 1 },
      )
      .lean()

    for (const row of rows) {
      for (const original of originalsByKey.get(row.value) ?? []) {
        suppressed.add(original)
      }
    }
    return suppressed
  }

  // ---------------------------------------------------------------------------
  // Write side
  // ---------------------------------------------------------------------------

  /**
   * Adds a value to the list. Idempotent: calling it twice yields one row.
   * The latest reason wins; evidence is only overwritten when new evidence
   * is supplied, so a STOP message is never erased by a later manual add.
   *
   * Throws 400 when the value cannot be normalised, because a manual entry
   * that we cannot match against anything protects nobody and would mislead
   * the operator into thinking it does.
   */
  async suppress(
    value: string,
    channel: Channel,
    user: UserRef,
    reason: SuppressionReason = SuppressionReason.MANUAL,
    evidence?: string,
  ): Promise<Suppression> {
    this.assertChannel(channel)
    const normalized = this.normalizeValue(value, channel)
    if (!normalized) {
      throw new HttpException(
        {
          error: `Cannot normalise "${value}" as a ${channel} address`,
        },
        HttpStatus.BAD_REQUEST,
      )
    }
    return this.upsertByKey(normalized, channel, user, reason, evidence)
  }

  /**
   * The actual write. `key` is already whatever we are going to store.
   */
  private async upsertByKey(
    key: string,
    channel: Channel,
    user: UserRef,
    reason: SuppressionReason,
    evidence?: string,
  ): Promise<Suppression> {
    if (!Object.values(SuppressionReason).includes(reason)) {
      throw new HttpException(
        { error: `Unknown suppression reason "${reason}"` },
        HttpStatus.BAD_REQUEST,
      )
    }

    const userId = this.userId(user)
    const filter = { user: userId, channel, value: key }
    const update: Record<string, any> = {
      $setOnInsert: { user: userId, channel, value: key },
      $set: { reason },
    }
    if (typeof evidence === 'string' && evidence.length > 0) {
      update.$set.evidence = evidence.slice(0, MAX_EVIDENCE_LENGTH)
    }

    let row: Suppression
    try {
      row = await this.suppressionModel.findOneAndUpdate(filter, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      })
    } catch (err) {
      // Two inbound STOPs from the same number in the same instant can both
      // decide to insert. The unique index rejects one; that one just reads
      // the winner. Anything else is a real error.
      if (err?.code !== MONGO_DUPLICATE_KEY) throw err
      row = await this.suppressionModel.findOne(filter)
    }

    await this.markContactsOptedOut(key, channel, userId)
    return row
  }

  /**
   * Mirrors the suppression onto the contact record so that anything reading
   * contacts directly (audience previews, exports) sees the opt-out too.
   */
  private async markContactsOptedOut(
    key: string,
    channel: Channel,
    userId: Types.ObjectId | string,
  ): Promise<void> {
    const addressField = channel === Channel.SMS ? 'phone' : 'email'
    const consentField = channel === Channel.SMS ? 'smsConsent' : 'emailConsent'
    await this.contactModel.updateMany(
      { user: userId, [addressField]: key },
      { $set: { optedOutAt: new Date(), [consentField]: false } },
    )
  }

  /**
   * Re-grants consent after an explicit START. The inbound keyword is itself
   * the consent record, so consentSource says where it came from.
   */
  private async markContactsOptedIn(
    key: string,
    channel: Channel,
    userId: Types.ObjectId | string,
  ): Promise<void> {
    const addressField = channel === Channel.SMS ? 'phone' : 'email'
    const consentField = channel === Channel.SMS ? 'smsConsent' : 'emailConsent'
    await this.contactModel.updateMany(
      { user: userId, [addressField]: key },
      {
        $set: {
          [consentField]: true,
          consentSource: `${channel}:start`,
          consentAt: new Date(),
        },
        $unset: { optedOutAt: 1 },
      },
    )
  }

  /**
   * Removes a value from the list. This is the ONLY way an entry leaves;
   * imports and syncs never call it. Does not touch contact consent: the
   * person still has to opt in again through a recorded channel.
   */
  async unsuppress(
    value: string,
    channel: Channel,
    user: UserRef,
  ): Promise<{ deleted: boolean }> {
    this.assertChannel(channel)
    const keys = this.lookupKeys(value, channel)
    if (keys.length === 0) return { deleted: false }
    const result = await this.suppressionModel.deleteMany({
      user: this.userId(user),
      channel,
      value: { $in: keys },
    })
    return { deleted: (result?.deletedCount ?? 0) > 0 }
  }

  /** DELETE /suppression/:id. Scoped to the owner; 404 otherwise. */
  async removeSuppressionById(id: string, user: UserRef): Promise<Suppression> {
    if (!Types.ObjectId.isValid(id)) {
      throw new HttpException(
        { error: 'Suppression not found' },
        HttpStatus.NOT_FOUND,
      )
    }
    const row = await this.suppressionModel.findOneAndDelete({
      _id: id,
      user: this.userId(user),
    })
    if (!row) {
      throw new HttpException(
        { error: 'Suppression not found' },
        HttpStatus.NOT_FOUND,
      )
    }
    return row
  }

  async listSuppressions(
    user: UserRef,
    options: ListSuppressionsOptions = {},
  ): Promise<{ data: Suppression[]; meta: Record<string, number> }> {
    const page = Math.max(1, Math.floor(Number(options.page) || 1))
    const requested = Math.floor(Number(options.limit) || DEFAULT_PAGE_LIMIT)
    const limit = Math.min(Math.max(1, requested), MAX_PAGE_LIMIT)
    const skip = (page - 1) * limit

    const filter: Record<string, any> = { user: this.userId(user) }
    if (options.channel) {
      this.assertChannel(options.channel)
      filter.channel = options.channel
    }

    const total = await this.suppressionModel.countDocuments(filter)
    const data: Suppression[] = await this.suppressionModel
      .find(filter, null, { sort: { createdAt: -1 }, skip, limit })
      .lean()

    return {
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      data,
    }
  }

  // ---------------------------------------------------------------------------
  // Gateway hook
  // ---------------------------------------------------------------------------

  /**
   * Called for every inbound SMS. Decides whether it is a consent keyword.
   *
   * If the sender cannot be normalised (alphanumeric sender id, local number
   * with no configured country code) a STOP is still recorded under the raw
   * sender string rather than discarded: an opt-out we cannot file perfectly
   * is still an opt-out, and `lookupKeys` will find the raw form later.
   */
  async handleInboundMessage(
    inbound: InboundMessageDTO,
    user: UserRef,
  ): Promise<InboundMessageOutcomeDTO> {
    const sender = inbound?.sender
    const message = inbound?.message
    const channel = Channel.SMS

    const normalizedSender = this.normalizeValue(sender, channel)
    const key = normalizedSender ?? this.rawKey(sender, channel)

    if (isOptOutMessage(message)) {
      if (!key) {
        // No sender at all: nothing to suppress, but do not pretend it was a
        // normal reply either.
        return { action: 'inbox', flaggedForReview: true }
      }
      const evidence =
        typeof message === 'string' ? message : JSON.stringify(message)
      await this.upsertByKey(
        key,
        channel,
        user,
        SuppressionReason.STOP,
        evidence,
      )
      return {
        action: 'suppressed',
        confirmationReply: OPT_OUT_CONFIRMATION_REPLY,
        normalizedSender: normalizedSender ?? undefined,
      }
    }

    if (isOptInMessage(message)) {
      if (!key) return { action: 'inbox' }
      // Only a canonical address can be re-consented; a raw key cannot be
      // matched to a contact, so the list entry is removed and that is all.
      await this.unsuppress(sender, channel, user)
      if (normalizedSender) {
        await this.markContactsOptedIn(
          normalizedSender,
          channel,
          this.userId(user),
        )
      }
      return {
        action: 'resubscribed',
        confirmationReply: OPT_IN_CONFIRMATION_REPLY,
        normalizedSender: normalizedSender ?? undefined,
      }
    }

    const outcome: InboundMessageOutcomeDTO = {
      action: 'inbox',
      normalizedSender: normalizedSender ?? undefined,
    }
    if (containsOptOutKeyword(message)) outcome.flaggedForReview = true
    return outcome
  }
}
