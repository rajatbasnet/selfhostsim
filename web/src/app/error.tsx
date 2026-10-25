'use client'

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-lg font-semibold">Something went wrong on this screen</div>
      <p className="max-w-sm text-sm text-mut">Nothing was sent or changed because of this. You can try again, or go back to the dashboard.</p>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="rounded-lg border border-line px-4 py-2 text-sm font-medium">
          Try again
        </button>
        <a href="/" className="rounded-lg bg-fg px-4 py-2 text-sm font-medium text-bg">
          Dashboard
        </a>
      </div>
    </div>
  )
}
