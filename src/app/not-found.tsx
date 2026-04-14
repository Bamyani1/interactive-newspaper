import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <div className="max-w-md text-center space-y-6 px-6">
        <h2 className="font-header text-2xl uppercase tracking-wide">
          Edition Not Found
        </h2>
        <p className="text-[var(--color-text-secondary)] text-sm">
          The page you’re looking for isn’t in the archive.
        </p>
        <div className="flex justify-center">
          <Link
            href="/"
            className="px-6 py-2.5 border border-[var(--color-accent)] text-[var(--color-accent)] text-sm uppercase tracking-widest hover:bg-[var(--color-accent)] hover:text-[var(--color-text-inverse)] transition-colors"
          >
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
