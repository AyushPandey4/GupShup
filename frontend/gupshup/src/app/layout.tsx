import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/contexts/auth-context'
import { ChatProvider } from '@/contexts/chat-context'
import { SocketProvider } from '@/contexts/socket-context'
import { Providers } from './providers'
import { Toaster } from '@/components/ui/sonner'

const inter = Inter({ subsets: ['latin'] })

// const Toaster = dynamic(
//   () => import('@/components/ui/sonner').then((c) => c.Toaster),
//   { ssr: false }
// )

export const metadata: Metadata = {
  title: 'GupShup - Connect, Chat & Share | Real-time Messaging App',
  description: 'GupShup is a modern real-time chat application featuring instant messaging, file sharing, audio/video calls, and group chats. Connect with friends and family securely.',
  keywords: 'chat app, messaging, real-time chat, instant messaging, file sharing, video calls, group chat',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  openGraph: {
    title: 'GupShup - Modern Real-time Chat Application',
    description: 'Connect and chat in real-time with GupShup. Share files, make calls, and stay connected.',
    type: 'website',
    siteName: 'GupShup',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GupShup - Modern Real-time Chat Application',
    description: 'Connect and chat in real-time with GupShup. Share files, make calls, and stay connected.',
  },
}


export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          src="https://apis.google.com/js/platform.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className={inter.className}>
        <Providers>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >

            <AuthProvider>
              <SocketProvider>
                <ChatProvider>
                  {children}
                  <Toaster richColors position="top-right" />
                </ChatProvider>
              </SocketProvider>
            </AuthProvider>

          </ThemeProvider>
        </Providers>
      </body>
    </html>
  )
}