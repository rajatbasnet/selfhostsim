import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  MessageTemplate,
  MessageTemplateDocument,
} from './schemas/template.schema'
import { User } from '../users/schemas/user.schema'
import { Channel } from '../sendline/sendline.enums'
import {
  CreateTemplateDTO,
  TemplatePreviewDTO,
  UpdateTemplateDTO,
} from './templates.dto'
import { MergeTagVars, renderTemplate } from './merge-tag-rendering'
import { countSmsSegments } from './sms-segmentation'

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
const MONGO_DUPLICATE_KEY = 11000

@Injectable()
export class TemplatesService {
  constructor(
    @InjectModel(MessageTemplate.name)
    private templateModel: Model<MessageTemplateDocument>,
  ) {}

  async createTemplate(
    input: CreateTemplateDTO,
    user: User,
  ): Promise<MessageTemplate> {
    const name = this.requireText(input?.name, 'name')
    const body = this.requireText(input?.body, 'body')
    const channel = this.requireChannel(input?.channel)
    const subject = this.subjectFor(channel, input?.subject)
    const slug = this.normalizeSlug(input?.slug)

    if (slug) {
      await this.assertSlugAvailable(slug, user)
    }

    try {
      return await this.templateModel.create({
        user: user._id,
        name,
        slug,
        channel,
        subject,
        body,
      })
    } catch (error) {
      this.rethrowDuplicateSlug(error, slug)
    }
  }

  async getTemplatesForUser(
    user: User,
    channel?: Channel,
  ): Promise<MessageTemplate[]> {
    const query: Record<string, unknown> = { user: user._id }
    if (channel) {
      query.channel = this.requireChannel(channel)
    }
    return await this.templateModel.find(query).sort({ createdAt: -1 })
  }

  async getTemplateById(
    templateId: string,
    user: User,
  ): Promise<MessageTemplateDocument> {
    const template = Types.ObjectId.isValid(templateId)
      ? await this.templateModel.findOne({ _id: templateId, user: user._id })
      : null

    if (!template) {
      throw new HttpException(
        { error: 'Template not found' },
        HttpStatus.NOT_FOUND,
      )
    }
    return template
  }

  /** Lookup by the stable machine name other apps post, e.g. 'order-shipped'. */
  async getTemplateBySlug(
    slug: string,
    user: User,
  ): Promise<MessageTemplateDocument> {
    const normalized = this.normalizeSlug(slug)
    const template = normalized
      ? await this.templateModel.findOne({ slug: normalized, user: user._id })
      : null

    if (!template) {
      throw new HttpException(
        { error: 'Template not found' },
        HttpStatus.NOT_FOUND,
      )
    }
    return template
  }

  async updateTemplate(
    templateId: string,
    input: UpdateTemplateDTO,
    user: User,
  ): Promise<MessageTemplate> {
    const template = await this.getTemplateById(templateId, user)
    const changes: Partial<MessageTemplate> = {}

    if (input?.name !== undefined) {
      changes.name = this.requireText(input.name, 'name')
    }
    if (input?.body !== undefined) {
      changes.body = this.requireText(input.body, 'body')
    }

    const channel =
      input?.channel !== undefined
        ? this.requireChannel(input.channel)
        : template.channel
    if (input?.channel !== undefined) {
      changes.channel = channel
    }

    const subjectInput =
      input?.subject !== undefined ? input.subject : template.subject
    const subject = this.subjectFor(channel, subjectInput)
    if (input?.subject !== undefined || input?.channel !== undefined) {
      changes.subject = subject
    }

    if (input?.slug !== undefined) {
      const slug = this.normalizeSlug(input.slug)
      if (slug && slug !== template.slug) {
        await this.assertSlugAvailable(slug, user, template._id)
      }
      changes.slug = slug
    }

    try {
      const updated = await this.templateModel.findOneAndUpdate(
        { _id: template._id, user: user._id },
        { $set: changes },
        { new: true },
      )
      if (!updated) {
        throw new HttpException(
          { error: 'Template not found' },
          HttpStatus.NOT_FOUND,
        )
      }
      return updated
    } catch (error) {
      this.rethrowDuplicateSlug(error, changes.slug)
    }
  }

  async deleteTemplate(
    templateId: string,
    user: User,
  ): Promise<{ deleted: boolean }> {
    const template = await this.getTemplateById(templateId, user)
    await this.templateModel.deleteOne({ _id: template._id, user: user._id })
    return { deleted: true }
  }

  /**
   * Renders a template with the given merge-tag values. Reports missing tags
   * and, for SMS, how many segments the rendered body would cost.
   */
  async renderPreview(
    templateId: string,
    vars: MergeTagVars,
    user: User,
  ): Promise<TemplatePreviewDTO> {
    const template = await this.getTemplateById(templateId, user)
    return this.renderTemplateDocument(template, vars)
  }

  /** Pure rendering of an already-loaded template; shared with campaigns. */
  renderTemplateDocument(
    template: MessageTemplate,
    vars: MergeTagVars,
  ): TemplatePreviewDTO {
    const safeVars = this.requireVars(vars)
    const body = renderTemplate(template.body, safeVars)
    const preview: TemplatePreviewDTO = {
      channel: template.channel,
      text: body.text,
      missing: [...body.missing],
    }

    if (template.channel === Channel.EMAIL) {
      const subject = renderTemplate(template.subject ?? '', safeVars)
      preview.subject = subject.text
      for (const tag of subject.missing) {
        if (!preview.missing.includes(tag)) preview.missing.push(tag)
      }
    }

    if (template.channel === Channel.SMS) {
      preview.segments = countSmsSegments(body.text)
    }

    return preview
  }

  private requireText(value: unknown, field: string): string {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) {
      throw new HttpException(
        { error: `${field} is required` },
        HttpStatus.BAD_REQUEST,
      )
    }
    return field === 'body' ? (value as string) : text
  }

  private requireChannel(value: unknown): Channel {
    if (!Object.values(Channel).includes(value as Channel)) {
      throw new HttpException(
        {
          error: `channel must be one of: ${Object.values(Channel).join(', ')}`,
        },
        HttpStatus.BAD_REQUEST,
      )
    }
    return value as Channel
  }

  /** Email needs a subject. SMS has none, so any provided subject is dropped. */
  private subjectFor(channel: Channel, subject: unknown): string | undefined {
    if (channel !== Channel.EMAIL) return undefined
    const text = typeof subject === 'string' ? subject.trim() : ''
    if (!text) {
      throw new HttpException(
        { error: 'subject is required for email templates' },
        HttpStatus.BAD_REQUEST,
      )
    }
    return text
  }

  private normalizeSlug(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string') {
      throw new HttpException(
        { error: 'slug must be a string' },
        HttpStatus.BAD_REQUEST,
      )
    }
    const slug = value.trim().toLowerCase()
    if (!slug) return undefined
    if (!SLUG_PATTERN.test(slug) || slug.length > 64) {
      throw new HttpException(
        {
          error:
            'slug may only contain lowercase letters, digits, - and _ (max 64)',
        },
        HttpStatus.BAD_REQUEST,
      )
    }
    return slug
  }

  private requireVars(vars: unknown): MergeTagVars {
    if (vars === undefined || vars === null) return {}
    if (typeof vars !== 'object' || Array.isArray(vars)) {
      throw new HttpException(
        { error: 'vars must be an object' },
        HttpStatus.BAD_REQUEST,
      )
    }
    return vars as MergeTagVars
  }

  private async assertSlugAvailable(
    slug: string,
    user: User,
    exceptId?: Types.ObjectId,
  ): Promise<void> {
    const query: Record<string, unknown> = { user: user._id, slug }
    if (exceptId) {
      query._id = { $ne: exceptId }
    }
    const existing = await this.templateModel.findOne(query)
    if (existing) {
      throw new HttpException(
        { error: `A template with slug '${slug}' already exists` },
        HttpStatus.CONFLICT,
      )
    }
  }

  /** The unique index is the last line of defence against a slug race. */
  private rethrowDuplicateSlug(error: unknown, slug?: string): never {
    if ((error as { code?: number })?.code === MONGO_DUPLICATE_KEY) {
      throw new HttpException(
        { error: `A template with slug '${slug}' already exists` },
        HttpStatus.CONFLICT,
      )
    }
    throw error
  }
}
