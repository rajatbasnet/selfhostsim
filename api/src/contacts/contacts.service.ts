import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { User } from '../users/schemas/user.schema'
import { Contact, ContactDocument } from './schemas/contact.schema'
import {
  CreateContactInputDTO,
  ImportContactsSummaryDTO,
  UpdateContactInputDTO,
} from './contacts.dto'
import {
  normalizeEmailAddress,
  normalizePhoneNumber,
} from './phone-number-normalization'
import { parseCsvWithHeader } from './csv-parsing'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

/** Values a human writes in a CSV "consent" column to mean yes. */
const TRUTHY_CELLS = new Set([
  'yes',
  'y',
  'true',
  '1',
  'on',
  'x',
  'granted',
  'consented',
  'subscribed',
  'opted_in',
  'opted-in',
  'optin',
  'opt-in',
  'opt_in',
])

/** Values that mean an explicit no, which must beat a file-level consentSource. */
const FALSY_CELLS = new Set([
  'no',
  'n',
  'false',
  '0',
  'off',
  'denied',
  'unsubscribed',
  'opted_out',
  'opted-out',
  'optout',
  'opt-out',
  'opt_out',
])

/** Header names (after normalizeCsvHeader) that feed a known field. */
const NAME_COLUMNS = [
  'name',
  'full_name',
  'fullname',
  'contact_name',
  'customer_name',
]
const FIRST_NAME_COLUMNS = ['first_name', 'firstname', 'given_name']
const LAST_NAME_COLUMNS = ['last_name', 'lastname', 'surname', 'family_name']
const PHONE_COLUMNS = [
  'phone',
  'phone_number',
  'phonenumber',
  'mobile',
  'mobile_number',
  'mobilenumber',
  'number',
  'tel',
  'telephone',
  'cell',
  'cellphone',
  'msisdn',
]
const EMAIL_COLUMNS = [
  'email',
  'email_address',
  'emailaddress',
  'e_mail',
  'mail',
]
const TAGS_COLUMNS = ['tags', 'tag', 'labels']
const CONSENT_COLUMNS = [
  'consent',
  'consented',
  'opt_in',
  'optin',
  'subscribed',
]
const CONSENT_SOURCE_COLUMNS = ['consent_source', 'consentsource']

const RESERVED_COLUMNS = new Set([
  ...NAME_COLUMNS,
  ...FIRST_NAME_COLUMNS,
  ...LAST_NAME_COLUMNS,
  ...PHONE_COLUMNS,
  ...EMAIL_COLUMNS,
  ...TAGS_COLUMNS,
  ...CONSENT_COLUMNS,
  ...CONSENT_SOURCE_COLUMNS,
])

export interface ListContactsOptions {
  search?: string
  tag?: string
  /** 'sms' | 'email' | 'any' | 'none' */
  consent?: string
  page?: number
  limit?: number
}

export interface ImportContactsOptions {
  defaultCountryCode?: string
  consentSource?: string
  tags?: string[]
}

export enum ImportSkipReason {
  NO_PHONE_OR_EMAIL = 'no_phone_or_email',
  INVALID_PHONE = 'invalid_phone',
  INVALID_EMAIL = 'invalid_email',
  DUPLICATE_IN_FILE = 'duplicate_in_file',
  CONFLICTS_WITH_EXISTING = 'conflicts_with_existing',
  WRITE_FAILED = 'write_failed',
}

/** The slice of an existing contact the importer needs to match against. */
interface ExistingContactMatch {
  _id: Types.ObjectId
  phone?: string
  email?: string
}

/** A CSV row after normalisation, ready to be written. */
interface PreparedRow {
  name: string
  phone: string | null
  email: string | null
  tags: string[]
  attributes: Record<string, string>
  consentGranted: boolean
  consentSource?: string
}

/** Characters that mean something inside a RegExp. User input never does. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  )
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    const trimmed = tag.trim()
    if (trimmed) seen.add(trimmed)
  }
  return [...seen]
}

function splitTagCell(cell: string): string[] {
  return cleanTags(cell.split(/[;,|]/))
}

function cleanAttributes(
  attributes: unknown,
): Record<string, string> | undefined {
  if (
    !attributes ||
    typeof attributes !== 'object' ||
    Array.isArray(attributes)
  ) {
    return undefined
  }
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(attributes)) {
    const safeKey = sanitizeAttributeKey(key)
    if (!safeKey) continue
    if (value === null || value === undefined) continue
    result[safeKey] = String(value)
  }
  return result
}

/** Mongo forbids '.' and a leading '$' in field names. */
function sanitizeAttributeKey(key: string): string {
  return key.replace(/\./g, '_').replace(/^\$+/, '').trim()
}

@Injectable()
export class ContactsService {
  constructor(
    @InjectModel(Contact.name) private contactModel: Model<ContactDocument>,
  ) {}

  async createContact(input: CreateContactInputDTO, user: User) {
    const { phone, email } = this.normalizeAddresses(
      input.phone,
      input.email,
      input.defaultCountryCode,
    )

    if (!phone && !email) {
      throw new HttpException(
        { error: 'A contact needs a phone number or an email address' },
        HttpStatus.BAD_REQUEST,
      )
    }

    await this.assertNoDuplicate(user, phone, email)

    const smsConsent = input.smsConsent === true
    const emailConsent = input.emailConsent === true
    const consentSource = input.consentSource?.trim() || undefined

    if ((smsConsent || emailConsent) && !consentSource) {
      throw new HttpException(
        { error: 'consentSource is required when recording consent' },
        HttpStatus.BAD_REQUEST,
      )
    }

    const doc: Partial<Contact> = {
      user: user._id,
      name: input.name?.trim() || '',
      tags: cleanTags(input.tags),
      attributes: cleanAttributes(input.attributes) || {},
      smsConsent,
      emailConsent,
    }
    if (phone) doc.phone = phone
    if (email) doc.email = email
    if (smsConsent || emailConsent) {
      doc.consentSource = consentSource
      doc.consentAt = new Date()
    }

    try {
      return await this.contactModel.create(doc)
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new HttpException(
          { error: 'A contact with this phone or email already exists' },
          HttpStatus.CONFLICT,
        )
      }
      throw error
    }
  }

  async getContactById(id: string, user: User) {
    if (!Types.ObjectId.isValid(id)) {
      throw new HttpException(
        { error: 'Contact not found' },
        HttpStatus.NOT_FOUND,
      )
    }
    const contact = await this.contactModel.findOne({ _id: id, user: user._id })
    if (!contact) {
      throw new HttpException(
        { error: 'Contact not found' },
        HttpStatus.NOT_FOUND,
      )
    }
    return contact
  }

  async updateContact(id: string, input: UpdateContactInputDTO, user: User) {
    const contact = await this.getContactById(id, user)

    const $set: Record<string, unknown> = {}
    const $unset: Record<string, 1> = {}

    let nextPhone = contact.phone
    let nextEmail = contact.email

    if ('phone' in input) {
      if (input.phone === null || input.phone === '') {
        nextPhone = undefined
      } else if (input.phone !== undefined) {
        const normalized = normalizePhoneNumber(input.phone, {
          defaultCountryCode: input.defaultCountryCode,
        })
        if (!normalized) {
          throw new HttpException(
            { error: 'Phone number could not be normalised' },
            HttpStatus.BAD_REQUEST,
          )
        }
        nextPhone = normalized
      }
    }

    if ('email' in input) {
      if (input.email === null || input.email === '') {
        nextEmail = undefined
      } else if (input.email !== undefined) {
        const normalized = normalizeEmailAddress(input.email)
        if (!normalized) {
          throw new HttpException(
            { error: 'Email address is not valid' },
            HttpStatus.BAD_REQUEST,
          )
        }
        nextEmail = normalized
      }
    }

    if (!nextPhone && !nextEmail) {
      throw new HttpException(
        { error: 'A contact needs a phone number or an email address' },
        HttpStatus.BAD_REQUEST,
      )
    }

    if (nextPhone !== contact.phone || nextEmail !== contact.email) {
      await this.assertNoDuplicate(
        user,
        nextPhone !== contact.phone ? nextPhone : null,
        nextEmail !== contact.email ? nextEmail : null,
        contact._id,
      )
    }

    if (nextPhone !== contact.phone) {
      if (nextPhone) $set.phone = nextPhone
      else $unset.phone = 1
    }
    if (nextEmail !== contact.email) {
      if (nextEmail) $set.email = nextEmail
      else $unset.email = 1
    }

    if (typeof input.name === 'string') $set.name = input.name.trim()
    if (input.tags !== undefined) $set.tags = cleanTags(input.tags)
    if (input.attributes !== undefined) {
      $set.attributes = cleanAttributes(input.attributes) || {}
    }

    const nextSmsConsent =
      typeof input.smsConsent === 'boolean'
        ? input.smsConsent
        : contact.smsConsent
    const nextEmailConsent =
      typeof input.emailConsent === 'boolean'
        ? input.emailConsent
        : contact.emailConsent
    const grantsNewConsent =
      (nextSmsConsent && !contact.smsConsent) ||
      (nextEmailConsent && !contact.emailConsent)
    const consentSource = input.consentSource?.trim() || contact.consentSource

    if (grantsNewConsent && !consentSource) {
      throw new HttpException(
        { error: 'consentSource is required when recording consent' },
        HttpStatus.BAD_REQUEST,
      )
    }

    if (typeof input.smsConsent === 'boolean')
      $set.smsConsent = input.smsConsent
    if (typeof input.emailConsent === 'boolean') {
      $set.emailConsent = input.emailConsent
    }
    if (grantsNewConsent) {
      $set.consentSource = consentSource
      $set.consentAt = new Date()
    } else if (input.consentSource?.trim()) {
      $set.consentSource = input.consentSource.trim()
    }

    if (input.optedOut === true) {
      $set.optedOutAt = new Date()
    } else if (input.optedOut === false) {
      $unset.optedOutAt = 1
    }

    const update: Record<string, unknown> = {}
    if (Object.keys($set).length) update.$set = $set
    if (Object.keys($unset).length) update.$unset = $unset
    if (!Object.keys(update).length) return contact

    try {
      return await this.contactModel.findOneAndUpdate(
        { _id: contact._id, user: user._id },
        update,
        { new: true },
      )
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new HttpException(
          { error: 'A contact with this phone or email already exists' },
          HttpStatus.CONFLICT,
        )
      }
      throw error
    }
  }

  async deleteContact(id: string, user: User) {
    const contact = await this.getContactById(id, user)
    await this.contactModel.deleteOne({ _id: contact._id, user: user._id })
    return contact
  }

  async listContacts(user: User, options: ListContactsOptions = {}) {
    const page = Math.max(1, Math.floor(Number(options.page)) || 1)
    const limit = Math.min(
      Math.max(1, Math.floor(Number(options.limit)) || DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    )
    const skip = (page - 1) * limit

    const filter: Record<string, unknown> = { user: user._id }

    const search = options.search?.trim()
    if (search) {
      const pattern = new RegExp(escapeRegExp(search), 'i')
      filter.$or = [{ name: pattern }, { phone: pattern }, { email: pattern }]
    }

    const tag = options.tag?.trim()
    if (tag) {
      filter.tags = tag
    }

    switch (options.consent) {
      case 'sms':
        filter.smsConsent = true
        break
      case 'email':
        filter.emailConsent = true
        break
      case 'any':
        filter.$and = [{ $or: [{ smsConsent: true }, { emailConsent: true }] }]
        break
      case 'none':
        filter.smsConsent = { $ne: true }
        filter.emailConsent = { $ne: true }
        break
      default:
        break
    }

    const [data, total] = await Promise.all([
      this.contactModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.contactModel.countDocuments(filter),
    ])

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async countContacts(user: User): Promise<number> {
    return await this.contactModel.countDocuments({ user: user._id })
  }

  /**
   * Imports a CSV with a header row. One bad row never aborts the file: it is
   * counted under skippedReasons and the import carries on.
   */
  async importContactsFromCsv(
    csvText: string,
    user: User,
    options: ImportContactsOptions = {},
  ): Promise<ImportContactsSummaryDTO> {
    const summary: ImportContactsSummaryDTO = {
      created: 0,
      updated: 0,
      skipped: 0,
      skippedReasons: {},
    }
    const skip = (reason: ImportSkipReason) => {
      summary.skipped++
      summary.skippedReasons[reason] = (summary.skippedReasons[reason] || 0) + 1
    }

    const { header, rows } = parseCsvWithHeader(csvText || '')
    if (header.length === 0) {
      throw new HttpException(
        { error: 'CSV is empty or has no header row' },
        HttpStatus.BAD_REQUEST,
      )
    }

    const phoneColumn = header.find((h) => PHONE_COLUMNS.includes(h))
    const emailColumn = header.find((h) => EMAIL_COLUMNS.includes(h))
    if (!phoneColumn && !emailColumn) {
      throw new HttpException(
        {
          error:
            'CSV needs a phone column (phone, mobile, number) or an email column (email, email_address)',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const nameColumn = header.find((h) => NAME_COLUMNS.includes(h))
    const firstNameColumn = header.find((h) => FIRST_NAME_COLUMNS.includes(h))
    const lastNameColumn = header.find((h) => LAST_NAME_COLUMNS.includes(h))
    const tagsColumn = header.find((h) => TAGS_COLUMNS.includes(h))
    const consentColumn = header.find((h) => CONSENT_COLUMNS.includes(h))
    const consentSourceColumn = header.find((h) =>
      CONSENT_SOURCE_COLUMNS.includes(h),
    )
    const attributeColumns = header.filter(
      (h) => !RESERVED_COLUMNS.has(h) && sanitizeAttributeKey(h),
    )

    const fileConsentSource = options.consentSource?.trim() || undefined
    const fileTags = cleanTags(options.tags)

    // Pass 1: normalise every row and dedupe within the file.
    const prepared: PreparedRow[] = []
    const seenPhones = new Set<string>()
    const seenEmails = new Set<string>()

    for (const row of rows) {
      const rawPhone = phoneColumn ? row[phoneColumn] : ''
      const rawEmail = emailColumn ? row[emailColumn] : ''

      if (!rawPhone && !rawEmail) {
        skip(ImportSkipReason.NO_PHONE_OR_EMAIL)
        continue
      }

      const phone = rawPhone
        ? normalizePhoneNumber(rawPhone, {
            defaultCountryCode: options.defaultCountryCode,
          })
        : null
      const email = rawEmail ? normalizeEmailAddress(rawEmail) : null

      // A row is only usable through addresses we could normalise. If it had
      // a phone we could not read and nothing else, that is the reason.
      if (!phone && !email) {
        if (rawPhone && !phone) skip(ImportSkipReason.INVALID_PHONE)
        else skip(ImportSkipReason.INVALID_EMAIL)
        continue
      }

      if (
        (phone && seenPhones.has(phone)) ||
        (email && seenEmails.has(email))
      ) {
        skip(ImportSkipReason.DUPLICATE_IN_FILE)
        continue
      }
      if (phone) seenPhones.add(phone)
      if (email) seenEmails.add(email)

      let name = nameColumn ? row[nameColumn] : ''
      if (!name && (firstNameColumn || lastNameColumn)) {
        name = [
          firstNameColumn ? row[firstNameColumn] : '',
          lastNameColumn ? row[lastNameColumn] : '',
        ]
          .filter(Boolean)
          .join(' ')
      }

      const tags = cleanTags([
        ...fileTags,
        ...(tagsColumn ? splitTagCell(row[tagsColumn]) : []),
      ])

      const attributes: Record<string, string> = {}
      for (const column of attributeColumns) {
        const value = row[column]
        if (value) attributes[sanitizeAttributeKey(column)] = value
      }

      const consentCell = consentColumn
        ? row[consentColumn].trim().toLowerCase()
        : ''
      let consentGranted: boolean
      if (consentCell && TRUTHY_CELLS.has(consentCell)) {
        consentGranted = true
      } else if (consentCell && FALSY_CELLS.has(consentCell)) {
        // An explicit "no" in the file beats a file-level source.
        consentGranted = false
      } else {
        consentGranted = Boolean(fileConsentSource)
      }
      const rowConsentSource = consentSourceColumn
        ? row[consentSourceColumn]
        : ''
      const consentSource = consentGranted
        ? rowConsentSource || fileConsentSource || 'csv'
        : undefined

      prepared.push({
        name: name.trim(),
        phone,
        email,
        tags,
        attributes,
        consentGranted,
        consentSource,
      })
    }

    if (prepared.length === 0) return summary

    // Pass 2: find what this user already has, in one query.
    const phones = prepared.map((r) => r.phone).filter(Boolean)
    const emails = prepared.map((r) => r.email).filter(Boolean)
    const lookup: Record<string, unknown>[] = []
    if (phones.length) lookup.push({ phone: { $in: phones } })
    if (emails.length) lookup.push({ email: { $in: emails } })

    const existing: ExistingContactMatch[] = lookup.length
      ? await this.contactModel
          .find({ user: user._id, $or: lookup })
          .select('_id phone email')
          .lean()
      : []

    const byPhone = new Map<string, ExistingContactMatch>()
    const byEmail = new Map<string, ExistingContactMatch>()
    for (const contact of existing) {
      if (contact.phone) byPhone.set(contact.phone, contact)
      if (contact.email) byEmail.set(contact.email, contact)
    }

    // Pass 3: write, one row at a time, never letting one failure stop the rest.
    const now = new Date()
    for (const row of prepared) {
      const matchByPhone = row.phone ? byPhone.get(row.phone) : undefined
      const matchByEmail = row.email ? byEmail.get(row.email) : undefined

      if (
        matchByPhone &&
        matchByEmail &&
        String(matchByPhone._id) !== String(matchByEmail._id)
      ) {
        // The row would stitch two existing contacts together. Not our call.
        skip(ImportSkipReason.CONFLICTS_WITH_EXISTING)
        continue
      }

      const match = matchByPhone || matchByEmail

      try {
        if (match) {
          const $set: Record<string, unknown> = {}
          if (row.name) $set.name = row.name
          if (row.phone && row.phone !== match.phone) $set.phone = row.phone
          if (row.email && row.email !== match.email) $set.email = row.email
          for (const [key, value] of Object.entries(row.attributes)) {
            $set[`attributes.${key}`] = value
          }
          if (row.consentGranted) {
            const finalPhone = row.phone || match.phone
            const finalEmail = row.email || match.email
            if (finalPhone) $set.smsConsent = true
            if (finalEmail) $set.emailConsent = true
            $set.consentSource = row.consentSource
            $set.consentAt = now
          }

          const update: Record<string, unknown> = {}
          if (Object.keys($set).length) update.$set = $set
          if (row.tags.length) update.$addToSet = { tags: { $each: row.tags } }

          if (Object.keys(update).length) {
            await this.contactModel.updateOne(
              { _id: match._id, user: user._id },
              update,
            )
          }
          summary.updated++
        } else {
          const doc: Partial<Contact> = {
            user: user._id,
            name: row.name,
            tags: row.tags,
            attributes: row.attributes,
            smsConsent: row.consentGranted && Boolean(row.phone),
            emailConsent: row.consentGranted && Boolean(row.email),
          }
          if (row.phone) doc.phone = row.phone
          if (row.email) doc.email = row.email
          if (row.consentGranted) {
            doc.consentSource = row.consentSource
            doc.consentAt = now
          }
          await this.contactModel.create(doc)
          summary.created++
        }
      } catch (error) {
        skip(
          isDuplicateKeyError(error)
            ? ImportSkipReason.CONFLICTS_WITH_EXISTING
            : ImportSkipReason.WRITE_FAILED,
        )
      }
    }

    return summary
  }

  private normalizeAddresses(
    rawPhone: string | undefined,
    rawEmail: string | undefined,
    defaultCountryCode?: string,
  ): { phone: string | null; email: string | null } {
    let phone: string | null = null
    let email: string | null = null

    if (typeof rawPhone === 'string' && rawPhone.trim()) {
      phone = normalizePhoneNumber(rawPhone, { defaultCountryCode })
      if (!phone) {
        throw new HttpException(
          {
            error:
              'Phone number could not be normalised. Use international format (+977...) or supply defaultCountryCode.',
          },
          HttpStatus.BAD_REQUEST,
        )
      }
    }

    if (typeof rawEmail === 'string' && rawEmail.trim()) {
      email = normalizeEmailAddress(rawEmail)
      if (!email) {
        throw new HttpException(
          { error: 'Email address is not valid' },
          HttpStatus.BAD_REQUEST,
        )
      }
    }

    return { phone, email }
  }

  private async assertNoDuplicate(
    user: User,
    phone: string | null | undefined,
    email: string | null | undefined,
    excludeId?: Types.ObjectId,
  ) {
    const or: Record<string, unknown>[] = []
    if (phone) or.push({ phone })
    if (email) or.push({ email })
    if (!or.length) return

    const filter: Record<string, unknown> = { user: user._id, $or: or }
    if (excludeId) filter._id = { $ne: excludeId }

    const existing = await this.contactModel.findOne(filter)
    if (existing) {
      throw new HttpException(
        { error: 'A contact with this phone or email already exists' },
        HttpStatus.CONFLICT,
      )
    }
  }
}
