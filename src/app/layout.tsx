import type { Metadata } from "next";
import {
  Playfair_Display,
  Source_Serif_4,
  JetBrains_Mono,
  Inter,
} from "next/font/google";
import "./globals.css";
import { ArchiveProvider } from "@/features/archive";
import { ThemeModeManager } from "@/features/theme";
import { MotionProvider } from "@/shared/motion/MotionProvider";
import { PageTransition } from "@/shared/motion/PageTransition";
import { ErrorBoundary } from "@/shared";
import { getEditionsList } from "@/src/lib/editions-server";

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
  weight: ["400", "500"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: true,
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
  const initialEditions = await getEditionsList();

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        data-mode="light"
        className={`${playfairDisplay.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} ${inter.variable} antialiased`}
      >
        <ThemeModeManager />
        <MotionProvider>
          <ArchiveProvider initialEditions={initialEditions}>
            <ErrorBoundary>
              <PageTransition>{children}</PageTransition>
            </ErrorBoundary>
          </ArchiveProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
