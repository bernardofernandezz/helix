import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { RootProvider } from 'fumadocs-ui/provider/next'
import './globals.css'

const siteUrl = 'https://www.helix.invalid'

export const metadata: Metadata = {
  title: 'Helix Docs',
  description: 'Documentation for Helix, the agentic research environment for the life sciences.',
  metadataBase: new URL(siteUrl),
  applicationName: 'Helix Docs',
  icons: {
    icon: '/docs/favicon.ico',
    shortcut: '/docs/favicon.ico'
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `${siteUrl}/docs`,
    siteName: 'Helix',
    title: 'Helix Docs',
    description: 'Documentation for Helix, the agentic research environment for the life sciences.'
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Helix Docs',
    description: 'Documentation for Helix, the agentic research environment for the life sciences.'
  },
  robots: {
    index: true,
    follow: true
  },
  alternates: {
    canonical: `${siteUrl}/docs`
  }
}

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="en" className="bg-background text-foreground" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <RootProvider search={{ enabled: false }} theme={{ defaultTheme: 'dark' }}>
          {children}
        </RootProvider>
      </body>
    </html>
  )
}
