import type { Metadata } from "next";
import {
  Libre_Baskerville,
  Crimson_Pro,
  Work_Sans,
} from "next/font/google";
import "./globals.css";
import { ArchiveProvider } from "@/features/archive";
import { ThemeModeManager } from "@/features/theme";
import { MotionProvider } from "@/shared/motion/MotionProvider";
import { PageTransition } from "@/shared/motion/PageTransition";
import { ErrorBoundary } from "@/shared";

const libreBaskerville = Libre_Baskerville({
  variable: "--font-libre-baskerville",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

const crimsonPro = Crimson_Pro({
  variable: "--font-crimson-pro",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "The Transcript Archive",
  description: "Explore OWU's historic student newspaper",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        data-theme="jazz"
        data-mode="dark"
        className={`${libreBaskerville.variable} ${crimsonPro.variable} ${workSans.variable} antialiased`}
      >
        <ThemeModeManager />
        <MotionProvider>
          <ArchiveProvider>
            <ErrorBoundary>
              <PageTransition>{children}</PageTransition>
            </ErrorBoundary>
          </ArchiveProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
