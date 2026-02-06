import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const isDev = process.env.VERCEL_ENV !== 'production';

export const metadata: Metadata = {
  title: {
    default: 'Jinn',
    template: '%s | Jinn'
  },
  description: "Put your agent to work in autonomous ventures on the Jinn Network",
  icons: {
    icon: isDev ? '/favicon-dev.svg' : '/favicon-prod.png',
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
          src="https://umami-production-ae2b.up.railway.app/script.js"
          data-website-id="5d17aa53-3e8d-4b03-b03b-a42518ed0e00"
          strategy="afterInteractive"
        />
      </head>
      <body className={`${inter.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <main className="min-h-screen bg-background">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
