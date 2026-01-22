import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ClientLayout } from "@/components/client-layout";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const isDev = process.env.VERCEL_ENV !== 'production';

export const metadata: Metadata = {
  title: {
    default: 'Jinn Explorer',
    template: '%s | Jinn Explorer'
  },
  description: "Database explorer for the Jinn project",
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
          data-website-id="cfa31df1-0dff-4c14-8a5b-cad39c8f12c5"
          strategy="afterInteractive"
        />
      </head>
      <body
        className={`${inter.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <ClientLayout>{children}</ClientLayout>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
// Deploy trigger: 2026-01-12T14:56:27Z
