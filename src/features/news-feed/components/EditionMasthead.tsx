"use client";

import React from "react";

interface EditionMastheadProps {
    editionHeaderDate: string;
}

export const EditionMasthead: React.FC<EditionMastheadProps> = ({ editionHeaderDate }) => {
    return (
        <div className="pb-4 px-6 text-center mb-6 max-w-5xl mx-auto w-full">
            <h2 className="font-masthead text-5xl md:text-6xl uppercase tracking-tight mb-2">
                The Transcript
            </h2>
            <div className="flex flex-wrap justify-between gap-2 border-t border-b border-[var(--color-text-primary)]/30 py-1.5 font-mono text-xs tracking-wider uppercase">
                <span className="opacity-60">Vol. 120 · No. 8</span>
                <span className="opacity-80">{editionHeaderDate}</span>
            </div>
        </div>
    );
};
