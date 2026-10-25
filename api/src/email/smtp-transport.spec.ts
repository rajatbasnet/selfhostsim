import * as nodemailer from 'nodemailer'
import {
  readSmtpConfig,
  SmtpConfigError,
  SmtpTransport,
} from './smtp-transport'

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

const fullEnv = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '2525',
  SMTP_SECURE: 'false',
  SMTP_USER: 'apikey',
  SMTP_PASS: 'secret',
  SMTP_FROM: 'Acme <no-reply@example.com>',
}

describe('readSmtpConfig', () => {
  it('reads a complete configuration', () => {
    expect(readSmtpConfig(fullEnv)).toEqual({
      host: 'smtp.example.com',
      port: 2525,
      secure: false,
      user: 'apikey',
      pass: 'secret',
      from: 'Acme <no-reply@example.com>',
    })
  })

  it('names every missing variable in one actionable error', () => {
    let error: unknown
    try {
      readSmtpConfig({})
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(SmtpConfigError)
    const message = (error as Error).message
    expect(message).toContain('Email is not configured')
    expect(message).toContain('SMTP_HOST')
    expect(message).toContain('SMTP_FROM')
  })

  it('treats blank strings as unset', () => {
    expect(() => readSmtpConfig({ ...fullEnv, SMTP_HOST: '   ' })).toThrow(
      /SMTP_HOST/,
    )
  })

  it('defaults the port to 587 and secure to false', () => {
    const { SMTP_PORT, SMTP_SECURE, ...env } = fullEnv
    void SMTP_PORT
    void SMTP_SECURE
    expect(readSmtpConfig(env)).toMatchObject({ port: 587, secure: false })
  })

  it('defaults secure to true on port 465', () => {
    const { SMTP_SECURE, ...env } = fullEnv
    void SMTP_SECURE
    expect(readSmtpConfig({ ...env, SMTP_PORT: '465' })).toMatchObject({
      port: 465,
      secure: true,
    })
  })

  it('lets SMTP_SECURE override the port default', () => {
    expect(
      readSmtpConfig({ ...fullEnv, SMTP_PORT: '465', SMTP_SECURE: 'false' }),
    ).toMatchObject({ secure: false })
    expect(
      readSmtpConfig({ ...fullEnv, SMTP_PORT: '587', SMTP_SECURE: 'true' }),
    ).toMatchObject({ secure: true })
  })

  it('rejects a port that is not a number', () => {
    expect(() => readSmtpConfig({ ...fullEnv, SMTP_PORT: 'abc' })).toThrow(
      /SMTP_PORT/,
    )
  })

  it('rejects an unparseable SMTP_SECURE', () => {
    expect(() => readSmtpConfig({ ...fullEnv, SMTP_SECURE: 'maybe' })).toThrow(
      /SMTP_SECURE/,
    )
  })

  it('allows an unauthenticated relay when user and pass are both unset', () => {
    const { SMTP_USER, SMTP_PASS, ...env } = fullEnv
    void SMTP_USER
    void SMTP_PASS
    expect(readSmtpConfig(env)).toMatchObject({
      user: undefined,
      pass: undefined,
    })
  })

  it('rejects a user without a password and vice versa', () => {
    const { SMTP_PASS, ...noPass } = fullEnv
    void SMTP_PASS
    expect(() => readSmtpConfig(noPass)).toThrow(/SMTP_USER and SMTP_PASS/)
    const { SMTP_USER, ...noUser } = fullEnv
    void SMTP_USER
    expect(() => readSmtpConfig(noUser)).toThrow(/SMTP_USER and SMTP_PASS/)
  })
})

describe('SmtpTransport', () => {
  const originalEnv = { ...process.env }

  const setEnv = (env: Record<string, string>) => {
    for (const key of SMTP_KEYS) delete process.env[key]
    Object.assign(process.env, env)
  }

  beforeEach(() => {
    jest.clearAllMocks()
    createTransport.mockReturnValue({ close: jest.fn() })
  })

  afterEach(() => {
    for (const key of SMTP_KEYS) delete process.env[key]
    Object.assign(process.env, originalEnv)
  })

  it('does not touch nodemailer until a transporter is asked for', () => {
    setEnv({})
    new SmtpTransport()
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('fails with the config error, not a nodemailer one, when env is missing', () => {
    setEnv({})
    const transport = new SmtpTransport()
    expect(() => transport.getTransporter()).toThrow(SmtpConfigError)
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('builds the transport from env and passes auth through', () => {
    setEnv(fullEnv)
    const transport = new SmtpTransport()
    transport.getTransporter()
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 2525,
      secure: false,
      auth: { user: 'apikey', pass: 'secret' },
    })
  })

  it('omits auth for an unauthenticated relay', () => {
    const { SMTP_USER, SMTP_PASS, ...env } = fullEnv
    void SMTP_USER
    void SMTP_PASS
    setEnv(env)
    new SmtpTransport().getTransporter()
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    )
  })

  it('creates the transport once and reuses it', () => {
    setEnv(fullEnv)
    const transport = new SmtpTransport()
    const first = transport.getTransporter()
    const second = transport.getTransporter()
    expect(first).toBe(second)
    expect(createTransport).toHaveBeenCalledTimes(1)
  })

  it('re-reads the environment after reset()', () => {
    setEnv(fullEnv)
    const transport = new SmtpTransport()
    const first = transport.getTransporter()
    setEnv({ ...fullEnv, SMTP_HOST: 'smtp.other.com' })
    transport.reset()
    transport.getTransporter()
    expect((first as any).close).toHaveBeenCalled()
    expect(createTransport).toHaveBeenCalledTimes(2)
    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: 'smtp.other.com' }),
    )
  })
})
