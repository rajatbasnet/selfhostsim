import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { normalizeEmailAddress } from '../contacts/phone-number-normalization'
import { SmtpConfigError, SmtpTransport } from './smtp-transport'

export interface SendEmailInput {
  to: string
  subject: string
  body: string
  /** Overrides SMTP_FROM for this one message. */
  from?: string
}

export interface SendEmailResult {
  /** The SMTP Message-ID, stored as Send.providerId. */
  messageId: string
}

export interface VerifyConnectionResult {
  ok: boolean
  error?: string
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * Wraps a plain-text body in just enough HTML that clients which prefer the
 * HTML part render paragraphs and line breaks the way the author typed them.
 * Nothing is interpreted: the text is escaped first, so a body containing
 * "<script>" arrives as the literal characters.
 */
export function textToMinimalHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => escapeHtml(paragraph).replace(/\n/g, '<br>\n'))
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join('\n')
  return (
    '<!doctype html>\n<html><body style="font-family: sans-serif; ' +
    'white-space: normal; line-height: 1.5;">\n' +
    paragraphs +
    '\n</body></html>'
  )
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)

  constructor(private readonly smtpTransport: SmtpTransport) {}

  async sendEmail({
    to,
    subject,
    body,
    from,
  }: SendEmailInput): Promise<SendEmailResult> {
    const recipient = normalizeEmailAddress(to)
    if (!recipient) {
      throw new HttpException(
        { error: `"${to}" is not a valid email address` },
        HttpStatus.BAD_REQUEST,
      )
    }
    if (typeof subject !== 'string' || subject.trim() === '') {
      throw new HttpException(
        { error: 'Email subject cannot be blank' },
        HttpStatus.BAD_REQUEST,
      )
    }
    if (typeof body !== 'string' || body.trim() === '') {
      throw new HttpException(
        { error: 'Email body cannot be blank' },
        HttpStatus.BAD_REQUEST,
      )
    }

    // Resolve the transport (and therefore the config) before touching the
    // network so a missing SMTP_HOST reads as exactly that.
    const transporter = this.smtpTransport.getTransporter()
    const config = this.smtpTransport.getConfig()

    const info = await transporter.sendMail({
      from: from?.trim() || config.from,
      to: recipient,
      subject: subject.trim(),
      text: body,
      html: textToMinimalHtml(body),
    })

    const messageId = info?.messageId
    if (!messageId) {
      // Every real SMTP server returns one; its absence means the transport
      // is not what we think it is. Fail loudly rather than record a blank id.
      throw new Error(
        'SMTP server accepted the message but returned no message id',
      )
    }

    return { messageId }
  }

  /** For the Settings screen "test connection" button. Never throws. */
  async verifyConnection(): Promise<VerifyConnectionResult> {
    try {
      const transporter = this.smtpTransport.getTransporter()
      await transporter.verify()
      return { ok: true }
    } catch (e) {
      const error =
        e instanceof SmtpConfigError
          ? e.message
          : `SMTP connection failed: ${e?.message ?? String(e)}`
      this.logger.warn(error)
      return { ok: false, error }
    }
  }
}
