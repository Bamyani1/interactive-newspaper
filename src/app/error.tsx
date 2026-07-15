"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/shared/ui/primitives";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ reset }: GlobalErrorProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-screen items-center justify-center bg-[var(--color-bg-primary)] px-6 text-[var(--color-text-primary)]"
    >
      <div className="max-w-md space-y-6 text-center">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-header text-2xl uppercase tracking-wide focus:outline-none"
        >
          Something Went Wrong
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          We couldn’t display this page. Please try again.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Button type="button" variant="accent" onClick={reset}>
            Try Again
          </Button>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center border border-[var(--color-border-default)] px-6 py-2.5 text-sm uppercase tracking-widest transition-colors hover:border-[var(--color-text-primary)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
          >
            Return Home
          </Link>
        </div>
      </div>
    </main>
  );
}
