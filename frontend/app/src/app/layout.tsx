import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { Providers } from '@/components/providers';
import { NavHeader } from '@/components/nav-header';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://app.jinn.network'),
  title: {
    default: 'Jinn Launchpad',
    template: '%s | Jinn Launchpad',
  },
  description: 'Rally around ideas. Launch ventures on Base.',
  openGraph: {
    siteName: 'Jinn Launchpad',
    images: [{ url: '/og-default.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og-default.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          src="https://cloud.umami.is/script.js"
          data-website-id="748fefe3-aa39-4f01-b4e4-70ccd27ecc30"
          strategy="afterInteractive"
        />
      </head>
      <body className={`${inter.variable} antialiased`}>
        <Providers>
          <NavHeader />
          <main className="min-h-screen bg-background">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
