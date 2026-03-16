import type { Metadata } from 'next'
import { Cormorant_Garamond, DM_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { UserProvider } from '@/contexts/user'
import { UnreadMessagesProvider } from '@/contexts/unread-messages'
import { CallProvider } from '@/contexts/call'
import { GlobalCursors } from '@/components/global-cursors'
import { GlobalMediaPlayer } from '@/components/global-media-player'
import './globals.css'

const cormorant = Cormorant_Garamond({ 
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-serif',
  display: 'swap',
})

const dmSans = DM_Sans({ 
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Nous',
  description: 'A private space for two',
  icons: {
    icon: [
      {
        url: '/icon.svg',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon.svg',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${cormorant.variable} ${dmSans.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <UserProvider>
          <UnreadMessagesProvider>
            <CallProvider>
              <GlobalCursors />
              {children}
              <GlobalMediaPlayer />
            </CallProvider>
          </UnreadMessagesProvider>
        </UserProvider>
        <Analytics />
      </body>
    </html>
  )
}
