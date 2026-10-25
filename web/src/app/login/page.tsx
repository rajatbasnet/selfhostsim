'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState, type FormEvent } from 'react'
import { api, API_BASE, describeError } from '@/lib/api'
import { isLoggedIn, setToken } from '@/lib/auth'
import type { LoginResponse } from '@/lib/types'
import { Button, Field, InlineError, Input } from '@/components/ui'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isLoggedIn()) router.replace('/')
  }, [router])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const data = await api.post<LoginResponse>('/auth/login', { username: username.trim(), password })
      const token = data?.accessToken
      if (!token) throw new Error('The server did not return a sign-in token.')
      setToken(token, data.user?.name || data.user?.username || username.trim())
      const next = params.get('next')
      router.replace(next && next.startsWith('/') && !next.startsWith('/login') ? next : '/')
    } catch (err) {
      const msg = describeError(err)
      setError(/401|unauthor|invalid|credential/i.test(msg) ? 'That username or password is not right.' : msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-fg text-base font-bold text-bg">S</span>
        <div>
          <div className="text-lg font-semibold">Sendline</div>
          <div className="text-xs text-mut">Sign in to your own server</div>
        </div>
      </div>
      <Field label="Username">
        <Input autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
      </Field>
      <Field label="Password">
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <InlineError message={error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-xs text-mut">
        Talking to <span className="font-mono">{API_BASE}</span>
      </p>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <Suspense fallback={<div className="text-sm text-mut">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
