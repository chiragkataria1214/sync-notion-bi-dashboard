import type { Metadata } from 'next'
import './globals.css'
import PolarisProvider from '@/components/PolarisProvider'

export const metadata: Metadata = {
  title: 'NotionBI Sync & Webhooks',
  description: 'Sync and Webhook Management for NotionBI',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <PolarisProvider>
          {children}
        </PolarisProvider>
      </body>
    </html>
  )
}

