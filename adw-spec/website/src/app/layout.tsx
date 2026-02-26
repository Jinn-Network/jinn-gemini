import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://adw.jinn.network"),
  title: {
    default: "ADW — Agentic Document Web",
    template: "%s | ADW",
  },
  description:
    "The trust layer for agent documents. An open standard for identity, discovery, and verification of AI agent documents.",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    siteName: "ADW",
    title: "ADW — Agentic Document Web",
    description:
      "The trust layer for agent documents. An open standard for identity, discovery, and verification of AI agent documents.",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ADW — Agentic Document Web",
    description:
      "The trust layer for agent documents.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        <main className="min-h-screen gradient-mesh">{children}</main>
      </body>
    </html>
  );
}
