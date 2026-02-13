"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useArchive } from "@/features/archive";
import { PageShell, SkeletonFeed } from "@/shared";
import { TimeControls } from "@/features/time-controls";

/**
 * /edition (no date param) → redirects to the latest available edition.
 * Keeps backward compatibility with old bookmarks.
 */
export default function EditionRedirect() {
  const router = useRouter();
  const { editions, hasEditions, isLoading } = useArchive();

  useEffect(() => {
    if (isLoading) return;
    if (hasEditions) {
      router.replace(`/edition/${editions[0]}`);
    }
  }, [editions, hasEditions, isLoading, router]);

  return (
    <PageShell variant="default" hasHeader>
      <TimeControls />
      <main className="min-h-screen w-full">
        <SkeletonFeed count={4} />
      </main>
    </PageShell>
  );
}
