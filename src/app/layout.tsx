import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  Playfair_Display,
  Source_Serif_4,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { ArchiveProvider } from "@/features/archive";
import { ThemePrepaintScript } from "@/features/theme/components/ThemePrepaintScript";
import { MotionProvider } from "@/shared/motion/MotionProvider";
import { ErrorBoundary } from "@/shared";
import { getEditionsList } from "@/src/lib/editions-server";

const isVercelDeployment = process.env.VERCEL === "1";

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: true,
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
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
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </ArchiveProvider>
        </MotionProvider>
        {isVercelDeployment ? <Analytics /> : null}
      </body>
    </html>
  );
}
