import { clearToken, getToken } from './auth'
import type { ListResponse, Meta } from './types'

export const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api/v1').replace(/\/+$/, '')

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Turn any thrown thing into one plain sentence a person can read. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Could not reach the Sendline server. Is it running?'
    if (err.status === 401) return 'You need to sign in again.'
    if (err.status === 403) return 'You are not allowed to do that.'
    if (err.status === 404) return 'That was not found. It may have been deleted.'
    if (err.status === 409) return err.message || 'That already exists.'
    if (err.status >= 500) return 'The server hit a problem. Try again in a moment.'
    return err.message || 'Something went wrong.'
  }
  if (err instanceof Error && err.message) return err.message
  return 'Something went wrong.'
}

function extractMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback
  const b = body as Record<string, unknown>
  const m = b.message ?? b.error
  if (Array.isArray(m)) return m.map(String).join(', ')
  if (typeof m === 'string') return m
  if (m && typeof m === 'object' && 'message' in (m as object)) {
    return String((m as Record<string, unknown>).message)
  }
  return fallback
}

interface RawEnvelope<T> {
  data?: T
  meta?: Meta
  message?: string
}

async function request<T>(method: string, path: string, body?: unknown): Promise<RawEnvelope<T>> {
  const token = getToken()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    throw new ApiError('Network error', 0)
  }

  let parsed: unknown = null
  const text = await res.text()
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { message: text.slice(0, 200) }
    }
  }

  if (res.status === 401 && typeof window !== 'undefined') {
    clearToken()
    if (!window.location.pathname.startsWith('/login')) {
      const next = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.assign(`/login?next=${next}`)
    }
  }

  if (!res.ok) {
    throw new ApiError(extractMessage(parsed, `Request failed (${res.status})`), res.status)
  }

  if (parsed && typeof parsed === 'object' && 'data' in (parsed as object)) {
    return parsed as RawEnvelope<T>
  }
  // Tolerate endpoints that return the payload bare.
  return { data: parsed as T }
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const api = {
  async get<T>(path: string): Promise<T> {
    const r = await request<T>('GET', path)
    return r.data as T
  },
  async list<T>(path: string): Promise<ListResponse<T>> {
    const r = await request<T[] | { items?: T[] }>('GET', path)
    const d = r.data
    if (Array.isArray(d)) return { data: d, meta: r.meta }
    if (d && typeof d === 'object' && Array.isArray((d as { items?: T[] }).items)) {
      return { data: (d as { items: T[] }).items, meta: r.meta }
    }
    return { data: [], meta: r.meta }
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    const r = await request<T>('POST', path, body ?? {})
    return r.data as T
  },
  async patch<T>(path: string, body: unknown): Promise<T> {
    const r = await request<T>('PATCH', path, body)
    return r.data as T
  },
  async put<T>(path: string, body: unknown): Promise<T> {
    const r = await request<T>('PUT', path, body)
    return r.data as T
  },
  /** `body` is for the few routes that take one, e.g. DELETE /lists/:id/members { contactIds }. */
  async del<T = unknown>(path: string, body?: unknown): Promise<T> {
    const r = await request<T>('DELETE', path, body)
    return r.data as T
  },
}
