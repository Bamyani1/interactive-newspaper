"use client";
import React, { useState } from "react";
import { Play, Music } from "lucide-react";
import { tracks } from "../data/musicData";

export const SidebarPlayer: React.FC = () => {
    const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
    const currentTrack = tracks[currentTrackIndex];

    return (
        <div className="relative w-full mb-6">
            {/* Decorative header */}
            <div className="flex items-center justify-center gap-2 mb-3">
                <div className="flex-1 h-0.5 bg-gradient-to-r from-transparent via-accent to-transparent" />
                <span className="text-xs uppercase tracking-[0.3em] text-accent font-medium">
                    1986 Top Hits
                </span>
                <div className="flex-1 h-0.5 bg-gradient-to-r from-transparent via-accent to-transparent" />
            </div>

            {/* Main player container */}
            <div className="relative bg-bg-secondary rounded-sm shadow-lg border border-accent/30 overflow-hidden">

                {/* YouTube Embed Iframe */}
                <div className="bg-black">
                    <iframe
                        src={`https://www.youtube.com/embed/${currentTrack.youtubeId}?rel=0`}
                        width="100%"
                        height="180"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        loading="lazy"
                        title={`${currentTrack.title} - ${currentTrack.artist}`}
                    />
                </div>

                {/* Playlist */}
                <div className="divide-y divide-accent/10">
                    {tracks.map((track, index) => (
                        <button
                            key={track.id}
                            type="button"
                            onClick={() => setCurrentTrackIndex(index)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all ${
                                index === currentTrackIndex
                                    ? "bg-accent/20 text-accent"
                                    : "hover:bg-accent/10 text-text-primary/80 hover:text-text-primary"
                            }`}
                        >
                            {/* Track number or playing indicator */}
                            <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                                {index === currentTrackIndex ? (
                                    <Music className="w-4 h-4 text-accent" />
                                ) : (
                                    <span className="text-xs text-text-primary/40 font-mono">
                                        {index + 1}
                                    </span>
                                )}
                            </div>

                            {/* Track info */}
                            <div className="flex-1 min-w-0">
                                <div className={`text-sm font-medium truncate ${
                                    index === currentTrackIndex ? "text-accent" : ""
                                }`}>
                                    {track.title}
                                </div>
                                <div className="text-xs text-text-primary/50 truncate">
                                    {track.artist}
                                </div>
                            </div>

                            {/* Play indicator on hover for non-active tracks */}
                            {index !== currentTrackIndex && (
                                <Play className="w-3.5 h-3.5 text-text-primary/30 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Decorative footer */}
            <div className="flex items-center justify-center gap-3 mt-3">
                <div className="w-1 h-1 rounded-full bg-accent/40" />
                <div className="w-1.5 h-1.5 rounded-full bg-accent/60" />
                <div className="w-1 h-1 rounded-full bg-accent/40" />
            </div>
        </div>
    );
};

