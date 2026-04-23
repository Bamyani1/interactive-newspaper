"use client";

import React from "react";
import { parsePublicationInfo } from "@/src/lib/parse-publication-info";

interface EditionMastheadProps {
    editionHeaderDate: string;
    publicationInfo?: string;
}

export const EditionMasthead: React.FC<EditionMastheadProps> = ({ editionHeaderDate, publicationInfo }) => {
    const parsed = parsePublicationInfo(publicationInfo);

    return (
        <div className="pb-4 px-6 text-center mb-6 max-w-5xl mx-auto w-full">
            <h2 className="font-masthead text-2xl sm:text-5xl md:text-6xl uppercase tracking-tight mb-2 text-balance">
                The Transcript
            </h2>
            <div className="flex flex-wrap justify-between gap-2 border-t border-b border-[var(--color-text-primary)]/30 py-1.5 font-mono text-xs tracking-wider uppercase">
                {parsed && (
                    <span className="opacity-60">Vol. {parsed.volume} · No. {parsed.issue}</span>
                )}
                <span className="opacity-80">{editionHeaderDate}</span>
            </div>
        </div>
    );
};
