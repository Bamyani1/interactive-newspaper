"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Music, Play } from "lucide-react";
import { playlists, resolveTracks } from "../data/musicData";
import { useMonthlyTrendingMusic } from "../hooks/useMonthlyTrendingMusic";

interface SidebarPlayerProps {
  currentDate?: string | null;
}

interface PlayerTrack {
  id: string;
  title: string;
  artist: string;
  youtubeId?: string | null;
}

const PROXIMITY_RADIUS = 240;
const BASE_OPACITY = 0.35;
const OPACITY_RANGE = 0.65;
const BASE_BRIGHTNESS = 0.7;
const BRIGHTNESS_RANGE = 0.3;
const LERP_FACTOR = 0.08;
const LERP_THRESHOLD = 0.001;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isCoarsePointerInput(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

function distanceToRect(clientX: number, clientY: number, rect: DOMRect): number {
  const dx =
    clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
  const dy =
    clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
  return Math.hypot(dx, dy);
}

function MessageCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="relative w-full mb-6">
      <h3
        className="uppercase font-mono text-[12px] tracking-[0.2em] mb-3 border-b border-dashed pb-1"
        style={{ borderColor: "var(--stroke-accent-soft)" }}
      >
        {title}
      </h3>
      <div
        className="border p-4 text-sm"
        style={{
          borderColor: "var(--color-border-default)",
          background: "color-mix(in srgb, var(--color-bg-secondary) 50%, transparent)",
        }}
      >
        <p className="text-text-primary/70">{body}</p>
      </div>
    </div>
  );
}

function toYoutubeSearchUrl(track: Pick<PlayerTrack, "title" | "artist">): string {
  const query = `${track.title} ${track.artist} official music video`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function TracksPlayer({
  tracks,
  currentTrackIndex,
  setCurrentTrackIndex,
  isTrackListOpen,
  setIsTrackListOpen,
  showEmbed,
  header,
}: {
  tracks: PlayerTrack[];
  currentTrackIndex: number;
  setCurrentTrackIndex: (value: number) => void;
  isTrackListOpen: boolean;
  setIsTrackListOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  showEmbed: boolean;
  header: React.ReactNode;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const currentTrack = tracks[currentTrackIndex];
  const trackIndexClamped = Math.min(currentTrackIndex, Math.max(0, tracks.length - 1));
  const effectiveTrack = currentTrack ?? tracks[trackIndexClamped];
  useEffect(() => {
    setIsPlaying(false);
  }, [effectiveTrack?.youtubeId]);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const eventRafRef = useRef<number | null>(null);
  const targetRef = useRef(0);
  const currentRef = useRef(0);
  const lerpRunningRef = useRef(false);
  const lerpRafRef = useRef<number | null>(null);
  const isCoarseRef = useRef(isCoarsePointerInput());
  const [isCoarsePointer, setIsCoarsePointer] = useState(isCoarsePointerInput);

  const applyStyles = () => {
    const el = surfaceRef.current;
    if (!el) return;
    const coarse = isCoarseRef.current;
    const p = currentRef.current;
    const opacity = coarse ? BASE_OPACITY : BASE_OPACITY + OPACITY_RANGE * p;
    const brightness = coarse ? 1 : BASE_BRIGHTNESS + BRIGHTNESS_RANGE * p;
    el.style.setProperty("--yt-surface-opacity", opacity.toFixed(3));
    el.style.setProperty("--yt-surface-brightness", brightness.toFixed(3));
  };

  const runLerp = () => {
    const diff = targetRef.current - currentRef.current;
    if (Math.abs(diff) < LERP_THRESHOLD) {
      currentRef.current = targetRef.current;
      applyStyles();
      lerpRunningRef.current = false;
      lerpRafRef.current = null;
      return;
    }
    currentRef.current += diff * LERP_FACTOR;
    applyStyles();
    lerpRafRef.current = requestAnimationFrame(runLerp);
  };

  const setTarget = (value: number) => {
    targetRef.current = clamp01(value);
    if (!lerpRunningRef.current) {
      lerpRunningRef.current = true;
      lerpRafRef.current = requestAnimationFrame(runLerp);
    }
  };

  useEffect(() => {
    isCoarseRef.current = isCoarsePointer;
    applyStyles();
  }, [isCoarsePointer]);

  useEffect(() => {
    applyStyles();
    return () => {
      if (lerpRafRef.current !== null) {
        cancelAnimationFrame(lerpRafRef.current);
        lerpRafRef.current = null;
      }
      lerpRunningRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const media = window.matchMedia("(pointer: coarse)");
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setIsCoarsePointer(event.matches);
    };
    const syncId = window.requestAnimationFrame(() => {
      setIsCoarsePointer(media.matches);
    });

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleMediaChange);
      return () => {
        window.cancelAnimationFrame(syncId);
        media.removeEventListener("change", handleMediaChange);
      };
    }

    const legacyListener = ((event: MediaQueryListEvent) => {
      setIsCoarsePointer(event.matches);
    }) as (this: MediaQueryList, ev: MediaQueryListEvent) => void;
    media.addListener(legacyListener);
    return () => {
      window.cancelAnimationFrame(syncId);
      media.removeListener(legacyListener);
    };
  }, []);

  useEffect(() => {
    if (!showEmbed || isCoarsePointer || typeof window === "undefined") {
      return undefined;
    }

    const updateProximity = (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      const distance = distanceToRect(clientX, clientY, rect);
      const next = clamp01(1 - distance / PROXIMITY_RADIUS);
      setTarget(next);
    };

    const onPointerMove = (event: PointerEvent | MouseEvent) => {
      if (eventRafRef.current !== null) {
        cancelAnimationFrame(eventRafRef.current);
      }

      eventRafRef.current = window.requestAnimationFrame(() => {
        eventRafRef.current = null;
        updateProximity(event.clientX, event.clientY);
      });
    };

    const onBlur = () => setTarget(0);

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("mousemove", onPointerMove, { passive: true });
    window.addEventListener("blur", onBlur);

    return () => {
      if (eventRafRef.current !== null) {
        cancelAnimationFrame(eventRafRef.current);
        eventRafRef.current = null;
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("blur", onBlur);
    };
  }, [showEmbed, isCoarsePointer]);

  if (!effectiveTrack) return null;

  return (
    <div className="relative w-full mb-4">
      <h3
        className="uppercase font-mono text-[12px] tracking-[0.2em] mb-2 border-b border-dashed pb-1"
        style={{ borderColor: "var(--stroke-accent-soft)" }}
      >
        {header}
      </h3>

      <div
        ref={surfaceRef}
        className="sidebar-player-surface"
        onPointerEnter={() => {
          if (!isCoarsePointer) {
            setTarget(1);
          }
        }}
        onPointerLeave={() => setTarget(0)}
      >
      <div
        className="relative border overflow-hidden"
        style={{
          borderColor: "var(--color-border-default)",
          background: "color-mix(in srgb, var(--color-bg-secondary) 50%, transparent)",
        }}
      >
        <div className="bg-black min-h-[140px]">
          {showEmbed && effectiveTrack.youtubeId ? (
            isPlaying ? (
              <iframe
                src={`https://www.youtube.com/embed/${effectiveTrack.youtubeId}?rel=0&autoplay=1`}
                width="100%"
                height="140"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={`${effectiveTrack.title} - ${effectiveTrack.artist}`}
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsPlaying(true)}
                className="relative w-full h-[140px] group cursor-pointer bg-black"
                aria-label={`Play ${effectiveTrack.title} by ${effectiveTrack.artist}`}
              >
                <img
                  src={`https://img.youtube.com/vi/${effectiveTrack.youtubeId}/mqdefault.jpg`}
                  alt=""
                  className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                    <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
                  </div>
                </div>
              </button>
            )
          ) : (
            <div className="h-[140px] flex items-center justify-center text-center px-3 text-xs text-text-primary/70 bg-[var(--color-bg-secondary)]">
              <div>
                <p className="font-medium">No verified video for this song</p>
                <p className="text-xs mt-1">Track list remains available for this month.</p>
                <a
                  href={toYoutubeSearchUrl(effectiveTrack)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center mt-3 px-2.5 py-1 text-xs font-medium border border-accent/40 rounded-sm text-accent hover:bg-accent/10 transition-colors"
                >
                  Open YouTube search
                </a>
              </div>
            </div>
          )}
        </div>

        <div
          className="border-t border-dashed"
          style={{ borderColor: "var(--color-border-default)" }}
        >
          <button
            type="button"
            onClick={() => setIsTrackListOpen((open) => !open)}
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-bg-secondary)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent/50"
            aria-expanded={isTrackListOpen}
            aria-controls="sidebar-track-list"
            id="sidebar-track-toggle"
          >
            <span className="flex-1 min-w-0 truncate font-mono text-[11px]">
              <span className="font-medium">{effectiveTrack.title}</span>
              <span className="text-text-primary/60"> — {effectiveTrack.artist}</span>
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 flex-shrink-0 opacity-60 transition-transform ${isTrackListOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          <div
            id="sidebar-track-list"
            role="region"
            aria-labelledby="sidebar-track-toggle"
            className={`grid transition-[grid-template-rows] duration-200 ease-out ${isTrackListOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="divide-y" style={{ '--tw-divide-color': 'var(--color-border-default)' } as React.CSSProperties}>
                {tracks.map((track, index) => {
                  const isActive = index === currentTrackIndex;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => {
                        setCurrentTrackIndex(index);
                        setIsTrackListOpen(false);
                      }}
                      className={`group w-full flex items-center gap-2 px-2.5 py-2 text-left transition-all ${
                        isActive
                          ? "bg-[var(--color-bg-secondary)] text-text-primary"
                          : "hover:bg-[var(--color-bg-secondary)] text-text-primary/70 hover:text-text-primary"
                      }`}
                    >
                      <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                        {isActive ? (
                          <Music className="w-3 h-3 text-text-primary/60" />
                        ) : (
                          <span className="text-[10px] text-text-primary/40 font-mono">{index + 1}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`font-mono text-[11px] truncate ${isActive ? "font-medium" : ""}`}>{track.title}</div>
                        <div className="font-mono text-[9px] text-text-primary/50 truncate">{track.artist}</div>
                      </div>
                      {!isActive && (
                        <Play className="w-3 h-3 text-text-primary/30 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

export const SidebarPlayer: React.FC<SidebarPlayerProps> = ({ currentDate = null }) => {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(playlists[0]?.id ?? "");
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isTrackListOpen, setIsTrackListOpen] = useState(false);

  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? playlists[0];
  const playlistTracks = useMemo(
    () => (selectedPlaylist ? resolveTracks(selectedPlaylist.trackIds) : []),
    [selectedPlaylist],
  );

  const {
    tracks: monthlyTracks,
    monthLabel,
    sourceLabel,
    isLoading,
    reason,
    error,
  } = useMonthlyTrendingMusic(currentDate);

  const monthlyPlayerTracks = useMemo<PlayerTrack[]>(
    () => monthlyTracks.map((track) => ({
      id: track.track_id,
      title: track.title,
      artist: track.artist,
      youtubeId: track.youtubeId,
    })),
    [monthlyTracks],
  );

  useEffect(() => {
    if (!currentDate || monthlyPlayerTracks.length === 0) {
      return;
    }

    const firstWithVideo = monthlyPlayerTracks.findIndex((track) => Boolean(track.youtubeId));
    setCurrentTrackIndex(firstWithVideo >= 0 ? firstWithVideo : 0);
    setIsTrackListOpen(false);
  }, [currentDate, monthlyPlayerTracks]);

  const legacyPlayerTracks = useMemo<PlayerTrack[]>(
    () => playlistTracks.map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      youtubeId: track.youtubeId,
    })),
    [playlistTracks],
  );

  if (currentDate) {
    if (isLoading) {
      return <MessageCard title="Monthly Top 10" body="Loading monthly chart data..." />;
    }

    if (error) {
      return <MessageCard title="Monthly Top 10" body="Unable to load monthly chart data right now." />;
    }

    if (reason === "OUT_OF_ARCHIVE_RANGE") {
      return (
        <MessageCard
          title="Monthly Top 10"
          body="No chart data is available for this month. Coverage starts at August 1958 and ends at December 2000."
        />
      );
    }

    if (reason === "NO_DATA") {
      return <MessageCard title="Monthly Top 10" body="No chart data was found for this month." />;
    }

    if (monthlyPlayerTracks.length === 0) {
      return <MessageCard title="Monthly Top 10" body="No tracks are available for this month." />;
    }

    return (
      <TracksPlayer
        tracks={monthlyPlayerTracks}
        currentTrackIndex={currentTrackIndex}
        setCurrentTrackIndex={setCurrentTrackIndex}
        isTrackListOpen={isTrackListOpen}
        setIsTrackListOpen={setIsTrackListOpen}
        showEmbed
        header={
          <>
            <span>{monthLabel} Top 10</span>
          </>
        }
      />
    );
  }

  if (legacyPlayerTracks.length === 0) {
    return null;
  }

  return (
    <TracksPlayer
      tracks={legacyPlayerTracks}
      currentTrackIndex={currentTrackIndex}
      setCurrentTrackIndex={setCurrentTrackIndex}
      isTrackListOpen={isTrackListOpen}
      setIsTrackListOpen={setIsTrackListOpen}
      showEmbed
      header={(
        <>
          <label className="sr-only" htmlFor="sidebar-playlist-select">
            Select playlist
          </label>
          <select
            id="sidebar-playlist-select"
            value={selectedPlaylistId}
            onChange={(event) => {
              setSelectedPlaylistId(event.target.value);
              setCurrentTrackIndex(0);
              setIsTrackListOpen(false);
            }}
            className="bg-transparent border-none cursor-pointer appearance-none pr-5 focus:outline-none focus:ring-0 py-0 font-mono text-[10px]"
          >
            {playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {playlist.name}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-accent pointer-events-none -ml-5" aria-hidden />
        </>
      )}
    />
  );
};
