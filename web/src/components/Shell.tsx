'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { clearToken, getUserName, isLoggedIn } from '@/lib/auth'
import { PhoneStatusPill } from './PhoneStatusPill'

interface NavItem {
  href: string
  label: string
  blurb: string
  icon: ReactNode
  mobile?: boolean
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const NAV: NavItem[] = [
  {
    href: '/',
    label: 'Dashboard',
    blurb: 'is the phone alive · what is sending',
    mobile: true,
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="5" rx="1.5" />
        <rect x="13" y="10" width="8" height="11" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/contacts',
    label: 'Contacts',
    blurb: 'people, consent, every message to them',
    mobile: true,
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
        <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.6 3.5 6" />
      </svg>
    ),
  },
  {
    href: '/lists',
    label: 'Lists',
    blurb: 'groups of people to send to',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <circle cx="4" cy="6" r="1" fill="currentColor" />
        <circle cx="4" cy="12" r="1" fill="currentColor" />
        <circle cx="4" cy="18" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: '/templates',
    label: 'Templates',
    blurb: 'write once, see the real character count',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M15 3v4h4M9 12h6M9 16h6" />
      </svg>
    ),
  },
  {
    href: '/campaigns',
    label: 'Campaigns',
    blurb: 'drafts, scheduled, sending, done',
    mobile: true,
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M3 11v2l11 4V7L3 11z" />
        <path d="M14 9.5c2 .5 3.5 1.2 3.5 2.5s-1.5 2-3.5 2.5M6 13.5l1 5.5h3" />
      </svg>
    ),
  },
  {
    href: '/inbox',
    label: 'Inbox',
    blurb: 'replies, newest first',
    mobile: true,
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M3 13l2.5-7h13L21 13v6H3z" />
        <path d="M3 13h5l1.5 2.5h5L16 13h5" />
      </svg>
    ),
  },
  {
    href: '/reports',
    label: 'Reports',
    blurb: 'delivered, failed, who to call back',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M4 20h16M6 16v-5M11 16V7M16 16v-9" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    blurb: 'the phone, email relay, pacing, API keys',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    ),
  },
]

function isCurrent(path: string, href: string): boolean {
  if (href === '/') return path === '/'
  return path === href || path.startsWith(href + '/')
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [userName, setUserName] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoggedIn()) {
      const next = encodeURIComponent(pathname || '/')
      router.replace(`/login?next=${next}`)
      return
    }
    setUserName(getUserName())
    setReady(true)
  }, [pathname, router])

  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-mut" aria-busy="true">
        Opening Sendline…
      </div>
    )
  }

  const logout = () => {
    clearToken()
    router.replace('/login')
  }

  const mobileItems = NAV.filter((n) => n.mobile)
  const moreItems = NAV.filter((n) => !n.mobile)
  const current = NAV.find((n) => isCurrent(pathname, n.href))

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 flex-none flex-col border-r border-line bg-side md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fg text-sm font-bold text-bg">S</span>
          <span className="text-base font-semibold">Sendline</span>
        </div>
        <nav className="flex-1 px-3" aria-label="Main">
          {NAV.map((n) => {
            const active = isCurrent(pathname, n.href)
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active ? 'bg-card font-semibold text-fg shadow-sm' : 'text-mut hover:bg-card/60 hover:text-fg'
                }`}
              >
                <span className="text-current">{n.icon}</span>
                <span>{n.label}</span>
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-line px-5 py-4 text-xs text-mut">
          {userName && <div className="mb-1 truncate text-fg">{userName}</div>}
          <button type="button" onClick={logout} className="underline hover:text-fg">
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-fg text-xs font-bold text-bg">S</span>
            <span className="truncate text-sm font-semibold">{current?.label ?? 'Sendline'}</span>
          </div>
          <div className="hidden text-sm text-mut md:block">{current?.blurb}</div>
          {/* flex-1 + min-w-0 all the way down, or the pill cannot shrink: its
              own max-w-full resolves against a content-sized inline-flex and
              the whole page scrolls sideways on a phone. */}
          <div className="flex min-w-0 flex-1 justify-end">
            <span className="hidden min-w-0 md:inline-flex">
              <PhoneStatusPill />
            </span>
            <span className="inline-flex min-w-0 md:hidden">
              <PhoneStatusPill compact />
            </span>
          </div>
        </header>

        <main className="flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-side pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
        {mobileItems.map((n) => {
          const active = isCurrent(pathname, n.href)
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${active ? 'text-fg' : 'text-mut'}`}
            >
              {n.icon}
              {n.label}
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${moreItems.some((n) => isCurrent(pathname, n.href)) ? 'text-fg' : 'text-mut'}`}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
            <circle cx="5" cy="12" r="1.2" fill="currentColor" />
            <circle cx="12" cy="12" r="1.2" fill="currentColor" />
            <circle cx="19" cy="12" r="1.2" fill="currentColor" />
          </svg>
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-mut">More</div>
            {moreItems.map((n) => (
              <Link key={n.href} href={n.href} className="flex items-center gap-3 rounded-lg px-2 py-3 text-base hover:bg-greyb">
                {n.icon}
                <span>
                  <span className="block">{n.label}</span>
                  <span className="block text-xs text-mut">{n.blurb}</span>
                </span>
              </Link>
            ))}
            <button type="button" onClick={logout} className="mt-2 w-full rounded-lg px-2 py-3 text-left text-sm text-mut hover:bg-greyb">
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
