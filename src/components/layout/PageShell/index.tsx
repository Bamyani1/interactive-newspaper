"use client";

import React from "react";
import styles from "./PageShell.module.css";

export type PageShellVariant = "default" | "cinema";

interface PageShellProps {
  children: React.ReactNode;
  /**
   * Layout variant:
   * - default: Standard scrollable page
   * - cinema: Full viewport with layered backgrounds (landing)
   */
  variant?: PageShellVariant;
  /**
   * Whether the page has a fixed header that needs offset
   */
  hasHeader?: boolean;
  /**
   * Optional background layer content (for cinema variant)
   */
  backgroundContent?: React.ReactNode;
  /**
   * Additional class names
   */
  className?: string;
}

/**
 * PageShell
 * 
 * A consistent wrapper component for all pages that handles:
 * - Background color application
 * - Layout variants (scrollable, cinema)
 * - Header offset when needed
 * - Background/content layer separation
 * 
 * Usage:
 * ```tsx
 * // Standard page
 * <PageShell variant="default" hasHeader>
 *   <main>...</main>
 * </PageShell>
 * 
 * // Landing page with background
 * <PageShell variant="cinema" backgroundContent={<BackgroundImage />}>
 *   <main>...</main>
 * </PageShell>
 * ```
 */
export const PageShell: React.FC<PageShellProps> = ({
  children,
  variant = "default",
  hasHeader = false,
  backgroundContent,
  className = "",
}) => {
  const shellClasses = [
    styles.pageShell,
    styles[variant],
    hasHeader && styles.withHeader,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // For variants with background layers
  if (backgroundContent) {
    return (
      <div className={shellClasses}>
        <div className={styles.backgroundLayer}>{backgroundContent}</div>
        <div className={styles.contentLayer}>{children}</div>
      </div>
    );
  }

  // Simple wrapper for default variant
  return <div className={shellClasses}>{children}</div>;
};

export default PageShell;
