import { renderTemplate } from '../templates/merge-tag-rendering'
import { Channel, SMS_OPT_OUT_NOTICE } from '../sendline/sendline.enums'
import { AudienceContact } from './audience-resolution'

/**
 * Pure message rendering for one recipient. The only place where a template,
 * a contact and the channel's legal requirements meet.
 */

export interface MessageTemplateLike {
  subject?: string | null
  body: string
}

export interface RenderedCampaignMessage {
  subject?: string
  body: string
  /** Merge tags that had no value for this contact (subject + body). */
  missing: string[]
}

/** The variables a template may reference for `contact`. */
export function mergeVarsForContact(
  contact: AudienceContact,
): Record<string, unknown> {
  const attributes = contact.attributes ?? {}
  return {
    ...attributes,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    attributes,
  }
}

/** A body "already says STOP" when it contains the word, case-insensitively. */
export function hasOptOutInstruction(body: string): boolean {
  return /stop/i.test(body ?? '')
}

/**
 * Appends the opt-out notice to a marketing SMS when the body does not already
 * carry one. Transactional sends never get it; that is the caller's choice.
 */
export function ensureSmsOptOutNotice(body: string): string {
  if (hasOptOutInstruction(body)) {
    return body
  }
  const trimmed = (body ?? '').replace(/\s+$/, '')
  return trimmed ? `${trimmed} ${SMS_OPT_OUT_NOTICE}` : SMS_OPT_OUT_NOTICE
}

export function renderCampaignMessage(input: {
  template: MessageTemplateLike
  contact: AudienceContact
  channel: Channel
  /** Default true. When false the SMS opt-out notice is not appended. */
  marketing?: boolean
}): RenderedCampaignMessage {
  const { template, contact, channel } = input
  const marketing = input.marketing !== false
  const vars = mergeVarsForContact(contact)

  const bodyRender = renderTemplate(template.body, vars)
  const missing = [...bodyRender.missing]
  let body = bodyRender.text
  let subject: string | undefined

  if (channel === Channel.EMAIL && template.subject) {
    const subjectRender = renderTemplate(template.subject, vars)
    subject = subjectRender.text
    for (const tag of subjectRender.missing) {
      if (!missing.includes(tag)) {
        missing.push(tag)
      }
    }
  }

  if (channel === Channel.SMS && marketing) {
    body = ensureSmsOptOutNotice(body)
  }

  return { subject, body, missing }
}
