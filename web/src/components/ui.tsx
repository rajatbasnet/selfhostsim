'use client'

import Link from 'next/link'
import { forwardRef, useEffect, type ReactNode } from 'react'

/* ---------- buttons ---------- */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const variantClass: Record<Variant, string> = {
  primary: 'bg-fg text-bg hover:opacity-90 border-transparent',
  secondary: 'bg-card text-fg border-line hover:bg-greyb',
  danger: 'bg-badb text-bad border-transparent hover:opacity-90',
  ghost: 'bg-transparent text-fg border-transparent hover:bg-greyb',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'lg' ? 'px-5 py-3 text-base' : 'px-4 py-2 text-sm'
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${sz} ${variantClass[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function LinkButton({
  href,
  variant = 'secondary',
  className = '',
  children,
}: {
  href: string
  variant?: Variant
  className?: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition ${variantClass[variant]} ${className}`}
    >
      {children}
    </Link>
  )
}

/* ---------- form fields ---------- */

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-mut">{hint}</span>}
    </label>
  )
}

const inputClass =
  'w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg placeholder:text-mut focus:border-link focus:outline-none focus:ring-2 focus:ring-link/30 disabled:opacity-60'

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input className={`${inputClass} ${className}`} {...rest} />
}

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(props, ref) {
  const { className = '', ...rest } = props
  return <textarea ref={ref} className={`${inputClass} min-h-[96px] ${className}`} {...rest} />
})

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props
  return (
    <select className={`${inputClass} ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function Checkbox({ label, hint, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--link)]" {...rest} />
      <span>
        <span className="text-fg">{label}</span>
        {hint && <span className="block text-xs text-mut">{hint}</span>}
      </span>
    </label>
  )
}

/* ---------- badges & chips ---------- */

type Tone = 'ok' | 'bad' | 'info' | 'warn' | 'grey'

const toneClass: Record<Tone, string> = {
  ok: 'bg-okb text-ok',
  bad: 'bg-badb text-bad',
  info: 'bg-infob text-info',
  warn: 'bg-warnb text-warn',
  grey: 'bg-greyb text-grey',
}

export function Badge({ tone = 'grey', children, className = '', title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${toneClass[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm transition ${
        active ? 'border-fg bg-fg text-bg' : 'border-line bg-card text-fg hover:bg-greyb'
      }`}
    >
      {children}
    </button>
  )
}

export function StatusBadge({ status }: { status: string | undefined }) {
  const tone: Tone =
    status === 'sending' || status === 'running'
      ? 'info'
      : status === 'done' || status === 'completed' || status === 'finished'
        ? 'ok'
        : status === 'failed'
          ? 'bad'
          : status === 'paused' || status === 'scheduled'
            ? 'warn'
            : 'grey'
  const label =
    status === 'sending' || status === 'running'
      ? 'Sending'
      : status === 'done' || status === 'completed' || status === 'finished'
        ? 'Done'
        : status === 'failed'
          ? 'Stopped with errors'
          : status === 'paused'
            ? 'Paused'
            : status === 'scheduled'
              ? 'Scheduled'
              : status === 'draft'
                ? 'Draft'
                : status === 'cancelled' || status === 'canceled'
                  ? 'Cancelled'
                  : status || 'Unknown'
  return <Badge tone={tone}>{label}</Badge>
}

/* ---------- layout ---------- */

export function Card({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`rounded-card border border-line bg-card ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-fg md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-mut">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatTile({ value, label, tone = 'grey', hint, href }: { value: ReactNode; label: string; tone?: Tone | 'plain'; hint?: string; href?: string }) {
  const color =
    tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : tone === 'info' ? 'text-info' : tone === 'warn' ? 'text-warn' : 'text-fg'
  const body = (
    <>
      <div className={`text-2xl font-semibold tabular-nums md:text-3xl ${color}`}>{value}</div>
      <div className="mt-1 text-sm text-mut">{label}</div>
      {hint && <div className="mt-1 text-xs text-mut">{hint}</div>}
    </>
  )
  const cls = 'rounded-card border border-line bg-card p-4'
  return href ? (
    <Link href={href} className={`${cls} block hover:bg-greyb`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/* ---------- states ---------- */

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="text-base font-medium text-fg">{title}</div>
      {body && <div className="max-w-md text-sm text-mut">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry, compact }: { message: string; onRetry?: () => void; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-center ${compact ? 'px-4 py-6' : 'px-6 py-12'}`}>
      <div className="text-sm font-medium text-bad">{message}</div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function InlineError({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <div role="alert" className="rounded-lg border border-bad/30 bg-badb px-3 py-2 text-sm text-bad">
      {message}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-lg px-3 py-2 text-sm ${toneClass[tone]}`}>{children}</div>
}

export function Loading({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-2 px-4 py-4" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-greyb" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  )
}

/* ---------- table ---------- */

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full min-w-[560px] text-sm">{children}</table>
    </div>
  )
}

export function Th({ children, className = '', right }: { children?: ReactNode; className?: string; right?: boolean }) {
  return (
    <th className={`whitespace-nowrap border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-mut ${right ? 'text-right' : 'text-left'} ${className}`}>
      {children}
    </th>
  )
}

export function Td({ children, className = '', right, mono }: { children?: ReactNode; className?: string; right?: boolean; mono?: boolean }) {
  return (
    <td className={`border-b border-line px-3 py-2 align-middle ${right ? 'text-right tabular-nums' : ''} ${mono ? 'font-mono text-xs' : ''} ${className}`}>
      {children}
    </td>
  )
}

/* ---------- modal ---------- */

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-card shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-mut hover:bg-greyb hover:text-fg">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

/* ---------- pagination ---------- */

export function Pager({ page, totalPages, onPage, total, noun }: { page: number; totalPages?: number; onPage: (p: number) => void; total?: number; noun?: string }) {
  const tp = totalPages ?? 1
  if (tp <= 1 && !total) return null
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-mut">
      <span>{total !== undefined ? `${new Intl.NumberFormat().format(total)} ${noun ?? 'in total'}` : ''}</span>
      {tp > 1 && (
        <span className="flex items-center gap-2">
          <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {tp}
          </span>
          <Button size="sm" disabled={page >= tp} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </span>
      )}
    </div>
  )
}

/* ---------- consent ---------- */

export function ConsentBadge({ consent, optedOut, suppressed, channel }: { consent: boolean | undefined; optedOut?: boolean; suppressed?: boolean; channel: 'sms' | 'email' }) {
  if (optedOut || suppressed) return <Badge tone="bad" title="This person replied STOP or was suppressed. They can never be selected for a send.">STOP</Badge>
  if (consent === true) return <Badge tone="ok">yes</Badge>
  if (consent === false) return <Badge tone="grey" title={`No ${channel === 'sms' ? 'SMS' : 'email'} consent recorded.`}>no consent</Badge>
  return <span className="text-mut">—</span>
}

/* ---------- confirm ---------- */

export function Confirm({ open, onClose, onConfirm, title, body, confirmLabel = 'Yes, do it', danger, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-fg">{body}</div>
    </Modal>
  )
}
