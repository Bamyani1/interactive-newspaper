import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { ArchiveProvider } from "@/features/archive";
import { ThemePrepaintScript } from "@/features/theme/components/ThemePrepaintScript";
import { MotionProvider } from "@/shared/motion/MotionProvider";
import { ErrorBoundary } from "@/shared";
import { getEditionsList } from "@/src/lib/editions-server";

const isVercelDeployment = process.env.VERCEL === "1";

// Self-hosted variable fonts (latin subset, from Fontsource; OFL licences
// beside them), so builds fetch nothing from Google Fonts.
const playfairDisplay = localFont({
  variable: "--font-playfair-display",
  display: "swap",
  src: [
    {
      path: "./fonts/playfair-display-latin-wght-normal.woff2",
      weight: "400 900",
      style: "normal",
    },
    {
      path: "./fonts/playfair-display-latin-wght-italic.woff2",
      weight: "400 900",
      style: "italic",
    },
  ],
  adjustFontFallback: "Times New Roman",
});

const sourceSerif = localFont({
  variable: "--font-source-serif",
  display: "swap",
  src: [
    { path: "./fonts/source-serif-4-latin-wght-normal.woff2", weight: "200 900", style: "normal" },
    { path: "./fonts/source-serif-4-latin-wght-italic.woff2", weight: "200 900", style: "italic" },
  ],
  adjustFontFallback: "Times New Roman",
});

const jetbrainsMono = localFont({
  variable: "--font-jetbrains",
  display: "swap",
  src: [
    { path: "./fonts/jetbrains-mono-latin-wght-normal.woff2", weight: "100 800", style: "normal" },
  ],
  fallback: ["monospace"],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "The Transcript Archive",
  description: "The Transcript Archive — explore OWU's historic student newspaper, 1950–2006",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const editionDates = (await getEditionsList())
    .map((edition) => edition.date)
    .sort((a, b) => a.localeCompare(b));

  // Per-request CSP nonce set by middleware.ts; the pre-paint theme script
  // needs it to run under the nonce-based script-src (no 'unsafe-inline').
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemePrepaintScript nonce={nonce} />
      </head>
      <body
        className={`${playfairDisplay.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <MotionProvider>
          <ArchiveProvider initialEditions={editionDates}>
            <ErrorBoundary>{children}</ErrorBoundary>
          </ArchiveProvider>
        </MotionProvider>
        {isVercelDeployment ? <Analytics /> : null}
      </body>
    </html>
  );
}
