import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-lg font-semibold">That page does not exist</div>
      <p className="max-w-sm text-sm text-mut">The link may be old, or the thing it pointed to was deleted.</p>
      <Link href="/" className="rounded-lg bg-fg px-4 py-2 text-sm font-medium text-bg">
        Back to the dashboard
      </Link>
    </div>
  )
}
