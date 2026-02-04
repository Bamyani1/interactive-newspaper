import { NextResponse } from "next/server";
import { tracks } from "@/features/music-player";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tracks });
}
