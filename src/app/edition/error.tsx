"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

export default function EditionError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <div className="max-w-md text-center space-y-6 px-6">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-header text-2xl uppercase tracking-wide focus:outline-none"
        >
          Edition Unavailable
        </h1>
        <p className="text-[var(--color-text-secondary)] text-sm">
          We couldn’t load this edition. Please try again.
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={reset}
            className="min-h-[44px] px-6 py-2.5 border border-[var(--color-accent)] text-[var(--color-accent)] text-sm uppercase tracking-widest hover:bg-[var(--color-accent)] hover:text-[var(--color-text-inverse)] transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
          >
            Try Again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center px-6 py-2.5 border border-[var(--color-border-default)] text-sm uppercase tracking-widest hover:border-[var(--color-text-primary)] transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
