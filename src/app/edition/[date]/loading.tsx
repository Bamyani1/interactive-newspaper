import { PageShell, SkeletonFeed } from "@/shared";

// Rendered during client-side navigation to a date that requires on-demand
// dynamic rendering (or while a stale cache entry is being revalidated).
// Statically pre-rendered editions skip this entirely.
export default function EditionLoading() {
  return (
    <PageShell variant="default" hasHeader className="edition-background-shell">
      <div className="paper-texture-overlay" aria-hidden="true" />
      {/* Header placeholder — matches the fixed TimeControls bar so the
          page doesn't shift down when the real header mounts. */}
      <div
        className="h-[var(--header-height)] w-full time-controls-header z-[var(--z-header)] fixed top-0 left-0"
        aria-hidden="true"
      />
      <main className="min-h-screen w-full lg:min-h-0 lg:h-[calc(100vh-var(--header-offset-total))] lg:overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[var(--sidebar-nav-width)_1fr_var(--sidebar-context-width)] w-full min-h-full lg:h-full">
          <div className="hidden lg:block lg:h-full border-r border-[var(--color-accent)]/50" />
          <div className="lg:overflow-y-auto lg:h-full scrollbar-hide pb-20 lg:pb-0">
            <SkeletonFeed count={4} />
          </div>
          <div className="hidden lg:block lg:h-full border-l border-[var(--color-accent)]/50" />
        </div>
      </main>
    </PageShell>
  );
}
