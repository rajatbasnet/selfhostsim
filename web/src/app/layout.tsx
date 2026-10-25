import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorker } from '@/components/ServiceWorker'

export const metadata: Metadata = {
  title: { default: 'Sendline', template: '%s · Sendline' },
  description: 'Self-hosted SMS and email campaigns from your own phone.',
  applicationName: 'Sendline',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Sendline',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf7' },
    { media: '(prefers-color-scheme: dark)', color: '#191917' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full font-sans">
        {children}
        <ServiceWorker />
      </body>
    </html>
  )
}
