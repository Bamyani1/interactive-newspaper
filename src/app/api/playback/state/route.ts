import { NextRequest, NextResponse } from "next/server";
import {
  playlists,
  tracks,
  type Track,
} from "@/features/music-player";
import crypto from "crypto";

export const dynamic = "force-dynamic";

type PlaybackState = {
  playlistId: string;
  trackId: string;
  positionMs: number;
  isPlaying: boolean;
  updatedAt: number;
};

const playbackStore = new Map<string, PlaybackState>();

const COOKIE_NAME = "playback_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const pickDefaultPlaylist = (): string => {
  return playlists[0]?.id ?? "";
};

const firstTrackInPlaylist = (playlistId: string): Track | undefined => {
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl) return undefined;
  return tracks.find((t) => t.id === pl.trackIds[0]);
};

const getSessionId = (req: NextRequest): string => {
  const existing = req.cookies.get(COOKIE_NAME)?.value;
  if (existing) return existing;
  return crypto.randomBytes(16).toString("hex");
};

const buildResponse = (sessionId: string, state: PlaybackState, track: Track) => {
  const res = NextResponse.json({
    sessionId,
    state: {
      playlistId: state.playlistId,
      trackId: state.trackId,
      positionMs: state.positionMs,
      isPlaying: state.isPlaying,
      updatedAt: state.updatedAt,
      track,
    },
  });

  res.cookies.set({
    name: COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
  });

  return res;
};

export async function GET(req: NextRequest) {
  const sessionId = getSessionId(req);
  let state = playbackStore.get(sessionId);

  if (!state) {
    const playlistId = pickDefaultPlaylist();
    const track = firstTrackInPlaylist(playlistId);
    if (!track) {
      return NextResponse.json(
        { error: "No tracks available" },
        { status: 500 }
      );
    }
    state = {
      playlistId,
      trackId: track.id,
      positionMs: 0,
      isPlaying: false,
      updatedAt: Date.now(),
    };
    playbackStore.set(sessionId, state);
  }

  const track = tracks.find((t) => t.id === state.trackId);
  if (!track) {
    return NextResponse.json(
      { error: "Track not found for state" },
      { status: 500 }
    );
  }

  return buildResponse(sessionId, state, track);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { trackId, positionMs, isPlaying, action } = body as {
    trackId?: string;
    positionMs?: number;
    isPlaying?: boolean;
    action?: "next" | "prev";
  };

  const sessionId = getSessionId(req);
  let state = playbackStore.get(sessionId);

  // Initialize if missing
  if (!state) {
    const playlistId = pickDefaultPlaylist();
    const track = firstTrackInPlaylist(playlistId);
    if (!track) {
      return NextResponse.json(
        { error: "No tracks available" },
        { status: 500 }
      );
    }
    state = {
      playlistId,
      trackId: track.id,
      positionMs: 0,
      isPlaying: false,
      updatedAt: Date.now(),
    };
  }

  // Update state based on payload
  const nextState: PlaybackState = { ...state };

  if (typeof trackId === "string") {
    nextState.trackId = trackId;
    nextState.positionMs = 0;
  }
  if (typeof positionMs === "number" && positionMs >= 0) {
    nextState.positionMs = positionMs;
  }
  if (typeof isPlaying === "boolean") {
    nextState.isPlaying = isPlaying;
  }

  if (action === "next" || action === "prev") {
    const pl = playlists.find((p) => p.id === nextState.playlistId);
    const sequence = pl ? pl.trackIds : [];
    if (sequence.length > 0) {
      const idx = sequence.indexOf(nextState.trackId);
      if (idx !== -1) {
        const delta = action === "next" ? 1 : -1;
        const nextIdx = (idx + delta + sequence.length) % sequence.length;
        nextState.trackId = sequence[nextIdx];
        nextState.positionMs = 0;
      }
    }
  }

  nextState.updatedAt = Date.now();
  playbackStore.set(sessionId, nextState);

  const track = tracks.find((t) => t.id === nextState.trackId);
  if (!track) {
    return NextResponse.json(
      { error: "Track not found after update" },
      { status: 500 }
    );
  }

  return buildResponse(sessionId, nextState, track);
}

