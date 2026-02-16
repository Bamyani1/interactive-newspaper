"use client";

export default function EditionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <div className="max-w-md text-center space-y-6 px-6">
        <h2 className="font-header text-2xl uppercase tracking-wide">
          Edition Unavailable
        </h2>
        <p className="text-[var(--color-text-secondary)] text-sm">
          {error.message || "Something went wrong loading this edition."}
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 border border-[var(--color-accent)] text-[var(--color-accent)] text-sm uppercase tracking-widest hover:bg-[var(--color-accent)] hover:text-[var(--color-text-inverse)] transition-colors"
          >
            Try Again
          </button>
          <a
            href="/"
            className="px-6 py-2.5 border border-[var(--color-border-default)] text-sm uppercase tracking-widest hover:border-[var(--color-text-primary)] transition-colors"
          >
            Home
          </a>
        </div>
      </div>
    </div>
  );
}
