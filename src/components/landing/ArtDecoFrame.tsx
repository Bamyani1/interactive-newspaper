"use client";

import React from "react";

/**
 * Decorative horizontal rule — center diamond flanked by thin lines.
 * Used above masthead and above CTA button.
 */
function DecoRule() {
    return (
        <div className="deco-rule" aria-hidden="true">
            <svg viewBox="0 0 200 12" preserveAspectRatio="none">
                {/* Left line */}
                <line x1="0" y1="6" x2="88" y2="6" stroke="currentColor" strokeWidth="1" />
                {/* Center diamond */}
                <polygon
                    points="100,1 106,6 100,11 94,6"
                    fill="var(--deco-frame-accent)"
                    stroke="currentColor"
                    strokeWidth="0.5"
                />
                {/* Right line */}
                <line x1="112" y1="6" x2="200" y2="6" stroke="currentColor" strokeWidth="1" />
            </svg>
        </div>
    );
}

/**
 * Corner fan ornament — 3 concentric quarter-circle arcs + L-shaped chevron.
 * Positioned top-left by default; CSS mirrors it to the other 3 corners.
 */
function CornerSVG() {
    return (
        <svg
            className="deco-corner"
            viewBox="0 0 36 36"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
        >
            {/* Three concentric quarter-circle arcs (fan motif) */}
            <path d="M2 2 Q2 16 16 16" stroke="currentColor" strokeWidth="1" fill="none" />
            <path d="M2 2 Q2 22 22 22" stroke="currentColor" strokeWidth="0.75" fill="none" />
            <path d="M2 2 Q2 28 28 28" stroke="currentColor" strokeWidth="0.5" fill="none" />
            {/* L-shaped chevron accent */}
            <line x1="2" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="1.5" />
            <line x1="2" y1="2" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
    );
}

interface ArtDecoFrameProps {
    children: React.ReactNode;
}

export function ArtDecoFrame({ children }: ArtDecoFrameProps) {
    return (
        <div className="deco-frame" aria-hidden={false}>
            <div className="deco-frame-inner">
                {/* Corner ornaments */}
                <CornerSVG />
                <CornerSVG />
                <CornerSVG />
                <CornerSVG />

                {/* Top decorative rule */}
                <DecoRule />

                {/* Card content */}
                <div className="deco-frame-content">
                    {children}
                </div>

                {/* Bottom decorative rule */}
                <DecoRule />
            </div>
        </div>
    );
}
