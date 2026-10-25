import { Injectable } from '@nestjs/common'
import * as nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

/**
 * SMTP configuration, read from the environment once and validated up front.
 *
 * nodemailer's own failures for a missing host or port are things like
 * "connect ECONNREFUSED 127.0.0.1:587", which tells an operator nothing about
 * what to fix. Every problem here is reported as the env var that needs to be
 * set, before a socket is ever opened.
 *
 *   SMTP_HOST    required  e.g. smtp.postmarkapp.com
 *   SMTP_PORT    optional  default 587
 *   SMTP_SECURE  optional  'true' for implicit TLS (port 465); defaults to
 *                          true when SMTP_PORT is 465, false otherwise
 *   SMTP_USER    optional  both or neither of SMTP_USER / SMTP_PASS
 *   SMTP_PASS    optional
 *   SMTP_FROM    required  the default From header, e.g. "Acme <no-reply@acme.com>"
 */
export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  from: string
}

export const SMTP_ENV_VARS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
] as const

export class SmtpConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SmtpConfigError'
  }
}

const DEFAULT_PORT = 587
const IMPLICIT_TLS_PORT = 465

type Env = Record<string, string | undefined>

const read = (env: Env, key: string): string | undefined => {
  const value = env[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const parseBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined
  const lowered = value.toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(lowered)) return true
  if (['false', '0', 'no', 'off'].includes(lowered)) return false
  return undefined
}

/**
 * Builds an SmtpConfig from `env`, or throws SmtpConfigError naming every
 * problem at once so an operator fixes the .env in one pass, not six.
 */
export function readSmtpConfig(env: Env = process.env): SmtpConfig {
  const problems: string[] = []

  const host = read(env, 'SMTP_HOST')
  if (!host) problems.push('SMTP_HOST is not set (e.g. smtp.example.com)')

  const rawPort = read(env, 'SMTP_PORT')
  let port = DEFAULT_PORT
  if (rawPort !== undefined) {
    const parsed = Number(rawPort)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      problems.push(`SMTP_PORT must be a port number, got "${rawPort}"`)
    } else {
      port = parsed
    }
  }

  const rawSecure = read(env, 'SMTP_SECURE')
  let secure = port === IMPLICIT_TLS_PORT
  if (rawSecure !== undefined) {
    const parsed = parseBoolean(rawSecure)
    if (parsed === undefined) {
      problems.push(`SMTP_SECURE must be "true" or "false", got "${rawSecure}"`)
    } else {
      secure = parsed
    }
  }

  const user = read(env, 'SMTP_USER')
  const pass = read(env, 'SMTP_PASS')
  if ((user && !pass) || (!user && pass)) {
    problems.push(
      'SMTP_USER and SMTP_PASS must be set together (or both left unset for an unauthenticated relay)',
    )
  }

  const from = read(env, 'SMTP_FROM')
  if (!from) {
    problems.push(
      'SMTP_FROM is not set (the default sender, e.g. "Acme <no-reply@example.com>")',
    )
  }

  if (problems.length > 0) {
    throw new SmtpConfigError(
      `Email is not configured. Fix the following in your environment and restart:\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    )
  }

  return { host, port, secure, user, pass, from }
}

/**
 * Lazily builds and caches one nodemailer transport for the process.
 *
 * Lazy so the API still boots (and SMS still works) on an install that has no
 * SMTP at all; the error surfaces on the first email, or on the Settings
 * screen's "test connection" button, with the message from readSmtpConfig.
 */
@Injectable()
export class SmtpTransport {
  private transporter: Transporter | null = null
  private config: SmtpConfig | null = null

  getConfig(): SmtpConfig {
    if (!this.config) {
      this.config = readSmtpConfig(process.env)
    }
    return this.config
  }

  getTransporter(): Transporter {
    if (!this.transporter) {
      const config = this.getConfig()
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user
          ? { user: config.user, pass: config.pass }
          : undefined,
      })
    }
    return this.transporter
  }

  /** Drops the cached transport so the next call re-reads the environment. */
  reset(): void {
    if (this.transporter && typeof this.transporter.close === 'function') {
      this.transporter.close()
    }
    this.transporter = null
    this.config = null
  }
}
