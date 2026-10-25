// Token storage. A single person on a single laptop: localStorage is enough,
// and a cookie mirror lets the app shell know whether to show /login.

const TOKEN_KEY = 'sendline.token'
const NAME_KEY = 'sendline.user'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string, name?: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
    if (name) window.localStorage.setItem(NAME_KEY, name)
    document.cookie = `sendline_auth=1; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`
  } catch {
    // Private browsing or blocked storage: the session simply will not persist.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
    window.localStorage.removeItem(NAME_KEY)
    document.cookie = 'sendline_auth=; path=/; max-age=0; SameSite=Lax'
  } catch {
    // ignore
  }
}

export function getUserName(): string | null {
  try {
    return window.localStorage.getItem(NAME_KEY)
  } catch {
    return null
  }
}

export function isLoggedIn(): boolean {
  return Boolean(getToken())
}
