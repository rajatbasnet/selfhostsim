import { Test, TestingModule } from '@nestjs/testing'
import { HttpException } from '@nestjs/common'
import * as nodemailer from 'nodemailer'
import { EmailService, textToMinimalHtml } from './email.service'
import { SmtpTransport } from './smtp-transport'

jest.mock('nodemailer')

const createTransport = nodemailer.createTransport as jest.Mock

const SMTP_KEYS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
]

const validEnv = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'apikey',
  SMTP_PASS: 'secret',
  SMTP_FROM: 'Acme <no-reply@example.com>',
}

describe('EmailService', () => {
  let service: EmailService
  const originalEnv = { ...process.env }

  const mockTransporter = {
    sendMail: jest.fn(),
    verify: jest.fn(),
    close: jest.fn(),
  }

  const setEnv = (env: Record<string, string>) => {
    for (const key of SMTP_KEYS) delete process.env[key]
    Object.assign(process.env, env)
  }

  /** The house convention puts the message in the { error } response body. */
  const httpErrorOf = async (promise: Promise<unknown>): Promise<string> => {
    try {
      await promise
    } catch (e) {
      if (e instanceof HttpException) {
        return String((e.getResponse() as Record<string, unknown>).error)
      }
      throw e
    }
    throw new Error('expected the call to reject')
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    createTransport.mockReturnValue(mockTransporter)
    mockTransporter.sendMail.mockResolvedValue({
      messageId: '<abc@example.com>',
    })
    mockTransporter.verify.mockResolvedValue(true)
    setEnv(validEnv)

    const module: TestingModule = await Test.createTestingModule({
      providers: [SmtpTransport, EmailService],
    }).compile()

    service = module.get<EmailService>(EmailService)
  })

  afterEach(() => {
    for (const key of SMTP_KEYS) delete process.env[key]
    Object.assign(process.env, originalEnv)
  })

  describe('sendEmail', () => {
    it('sends text and a minimal html part with the configured from', async () => {
      const result = await service.sendEmail({
        to: 'Asha@Example.com',
        subject: 'Your order',
        body: 'Hi Asha,\n\nYour order shipped.',
      })

      expect(result).toEqual({ messageId: '<abc@example.com>' })
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1)
      const mail = mockTransporter.sendMail.mock.calls[0][0]
      expect(mail.from).toBe('Acme <no-reply@example.com>')
      expect(mail.to).toBe('asha@example.com')
      expect(mail.subject).toBe('Your order')
      expect(mail.text).toBe('Hi Asha,\n\nYour order shipped.')
      expect(mail.html).toContain('<p>Hi Asha,</p>')
      expect(mail.html).toContain('<p>Your order shipped.</p>')
    })

    it('lets a per-message from override the default', async () => {
      await service.sendEmail({
        to: 'a@example.com',
        subject: 's',
        body: 'b',
        from: 'Support <help@example.com>',
      })
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'Support <help@example.com>' }),
      )
    })

    it('rejects an invalid to address before touching the transport', async () => {
      await expect(
        service.sendEmail({ to: 'not-an-email', subject: 's', body: 'b' }),
      ).rejects.toThrow(HttpException)
      expect(createTransport).not.toHaveBeenCalled()
      expect(mockTransporter.sendMail).not.toHaveBeenCalled()
    })

    it('rejects an empty subject', async () => {
      await expect(
        httpErrorOf(
          service.sendEmail({ to: 'a@example.com', subject: '   ', body: 'b' }),
        ),
      ).resolves.toMatch(/subject/i)
      expect(mockTransporter.sendMail).not.toHaveBeenCalled()
    })

    it('rejects an empty body', async () => {
      await expect(
        httpErrorOf(
          service.sendEmail({ to: 'a@example.com', subject: 's', body: '' }),
        ),
      ).resolves.toMatch(/body/i)
      expect(mockTransporter.sendMail).not.toHaveBeenCalled()
    })

    it('fails with an actionable error when SMTP is not configured', async () => {
      setEnv({})
      await expect(
        service.sendEmail({ to: 'a@example.com', subject: 's', body: 'b' }),
      ).rejects.toThrow(/SMTP_HOST/)
      expect(mockTransporter.sendMail).not.toHaveBeenCalled()
    })

    it('propagates a transport failure', async () => {
      mockTransporter.sendMail.mockRejectedValue(new Error('535 Auth failed'))
      await expect(
        service.sendEmail({ to: 'a@example.com', subject: 's', body: 'b' }),
      ).rejects.toThrow('535 Auth failed')
    })

    it('refuses to report success without a message id', async () => {
      mockTransporter.sendMail.mockResolvedValue({})
      await expect(
        service.sendEmail({ to: 'a@example.com', subject: 's', body: 'b' }),
      ).rejects.toThrow(/message id/)
    })

    it('escapes html in the body rather than interpreting it', async () => {
      await service.sendEmail({
        to: 'a@example.com',
        subject: 's',
        body: '<script>alert(1)</script> & "quotes"',
      })
      const mail = mockTransporter.sendMail.mock.calls[0][0]
      expect(mail.html).not.toContain('<script>')
      expect(mail.html).toContain('&lt;script&gt;')
      expect(mail.html).toContain('&amp;')
    })
  })

  describe('verifyConnection', () => {
    it('returns ok when the server answers', async () => {
      await expect(service.verifyConnection()).resolves.toEqual({ ok: true })
      expect(mockTransporter.verify).toHaveBeenCalled()
    })

    it('returns the config error when SMTP is not configured', async () => {
      setEnv({})
      const result = await service.verifyConnection()
      expect(result.ok).toBe(false)
      expect(result.error).toContain('SMTP_HOST')
      expect(mockTransporter.verify).not.toHaveBeenCalled()
    })

    it('returns the connection error instead of throwing', async () => {
      mockTransporter.verify.mockRejectedValue(new Error('ECONNREFUSED'))
      const result = await service.verifyConnection()
      expect(result).toEqual({
        ok: false,
        error: 'SMTP connection failed: ECONNREFUSED',
      })
    })
  })
})

describe('textToMinimalHtml', () => {
  it('turns blank lines into paragraphs and single newlines into breaks', () => {
    const html = textToMinimalHtml('one\ntwo\n\nthree')
    expect(html).toContain('<p>one<br>\ntwo</p>')
    expect(html).toContain('<p>three</p>')
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })

  it('handles windows line endings', () => {
    expect(textToMinimalHtml('a\r\n\r\nb')).toContain('<p>a</p>\n<p>b</p>')
  })
})
