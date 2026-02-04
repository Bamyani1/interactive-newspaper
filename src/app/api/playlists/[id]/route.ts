import { NextRequest, NextResponse } from "next/server";
import { playlists, resolveTracks } from "@/features/music-player";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const playlist = playlists.find((p) => p.id === id);
  if (!playlist) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tracks = resolveTracks(playlist.trackIds);
  return NextResponse.json({ ...playlist, tracks });
}

