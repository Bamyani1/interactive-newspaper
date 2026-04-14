import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

// Token-gated POST that drops the cached editions list. Call after
// `npm run db:seed` (or any other write that adds/removes editions) so
// the layout's 1h `unstable_cache` window doesn't keep stale data on screen.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const expected = process.env.ADMIN_REVALIDATE_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "ADMIN_REVALIDATE_TOKEN is not configured on the server" },
      { status: 503 },
    );
  }

  const provided = request.headers.get("X-Admin-Token");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Next.js 16 requires a second `profile` argument; "max" matches the
  // long-lived layout cache (`unstable_cache` revalidate=3600).
  revalidateTag("editions", "max");
  return NextResponse.json({ revalidated: true, tag: "editions" });
}
