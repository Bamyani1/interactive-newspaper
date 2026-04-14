import "server-only";
import { unstable_cache } from "next/cache";
import { queryEditions } from "@/src/lib/db";
import { GOLD_DATE, GOLD_EDITION_INFO, GOLD_FILE_EXISTS } from "@/src/lib/gold-edition";
import type { EditionInfo } from "@/src/types";

async function fetchEditionsListUncached(): Promise<EditionInfo[]> {
  let editions: EditionInfo[] = [];
  let dbError: unknown = null;
  try {
    ({ editions } = await queryEditions({ limit: 500 }));
  } catch (error) {
    // DB outage / credential failure / network blip. In dev we degrade
    // gracefully; in a production build we re-throw below so CI fails loudly
    // instead of silently shipping zero static pages.
    dbError = error;
    console.error("getEditionsList: failed to query editions:", error);
  }
  if (GOLD_FILE_EXISTS && !editions.some((e) => e.date === GOLD_DATE)) {
    editions.unshift(GOLD_EDITION_INFO);
  }
  if (editions.length === 0 && dbError && process.env.NODE_ENV === "production") {
    throw new Error(
      "getEditionsList: DB unreachable during build and no gold edition fallback. " +
        "Aborting to avoid shipping zero editions. Check DATABASE_URL and Neon status.",
    );
  }
  return editions;
}

// Tag-invalidatable so `revalidateTag("editions")` after `db:seed` refreshes everywhere.
export const getEditionsList = unstable_cache(
  fetchEditionsListUncached,
  ["editions-list-v1"],
  { tags: ["editions"], revalidate: 3600 },
);
