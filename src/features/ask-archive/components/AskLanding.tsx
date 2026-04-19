"use client";

import React, { useEffect, useMemo, useState } from "react";

interface AskLandingProps {
    /** Fire the given question against the live /api/ask flow. */
    onPickQuestion: (question: string) => void;
    /**
     * True when the hook reports `/api/ask/session` returned `expired:true`.
     * Rendered as a quiet inline notice between the H1 and the lede — not
     * a loud banner.
     */
    expiredBanner: boolean;
}

// Rotated by day-of-year so the landing feels maintained rather than
// cached. A twelve-entry pool is enough to vary without pretending to
// be a recommender system.
const QUESTION_POOL: readonly string[] = [
    "What was campus life like during Prohibition?",
    "How did OWU respond to the Vietnam War?",
    "Tell me about Homecoming in the 1970s.",
    "What did Bishop Kennedy say when he visited in 1960?",
    "How did the civil rights movement appear in the Transcript?",
    "When did women's varsity sports first show up?",
    "How did the paper cover the Kennedy assassination?",
    "What were the popular majors in 1955?",
    "Tell me about campus protests in 1968.",
    "What did the paper say about Earth Day 1970?",
    "What coverage did the 1969 moon landing get?",
    "What was the student dress code in the 1950s?",
];

// Excluded from the daily suggestions so we don't repeat it if we ever
// bring the demo back — and to keep the pool varied.
const EXCLUDED_FROM_ROTATION = "Tell me about Homecoming in the 1970s.";

const VISITED_KEY = "owu-has-visited-ask";

function pickSuggestions(date: Date, exclude: string): string[] {
    // Day-of-year rotation: same three every day, different every day.
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const dayIndex =
        date.getUTCFullYear() * 366 +
        Math.floor((date.getTime() - start) / 86_400_000);
    const pool = QUESTION_POOL.filter((q) => q !== exclude);
    return [0, 1, 2].map((i) => pool[(dayIndex + i) % pool.length]);
}

export const AskLanding: React.FC<AskLandingProps> = ({
    onPickQuestion,
    expiredBanner,
}) => {
    // Entrance animation runs once per browser. Returning visitors get
    // instant paint. Reading localStorage in a state initializer would
    // cause SSR/CSR hydration mismatches, so the flag flips post-mount.
    const [animate, setAnimate] = useState(false);
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            if (!window.localStorage.getItem(VISITED_KEY)) {
                // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot post-hydration gate
                setAnimate(true);
                window.localStorage.setItem(VISITED_KEY, "1");
            }
        } catch {
            // localStorage disabled (Safari private mode, etc.) —
            // just skip the animation gate.
        }
    }, []);

    const suggestions = useMemo(
        () => pickSuggestions(new Date(), EXCLUDED_FROM_ROTATION),
        [],
    );

    return (
        <div
            className="ask-landing"
            data-animate={animate ? "true" : undefined}
        >
            <h1 className="ask-landing-title">
                Ask the <em>archive</em>.
            </h1>

            {expiredBanner ? (
                <p className="ask-landing-notice" role="status">
                    Your last conversation expired. Starting fresh.
                </p>
            ) : null}

            <p className="ask-landing-lede">
                A research desk for <em>The Transcript</em>, Ohio Wesleyan&rsquo;s
                student paper. Every answer cites the stories it comes from —
                so you can verify before you quote.
            </p>

            <section
                className="ask-landing-suggestions"
                aria-label="Suggested questions, refreshed daily"
            >
                <header className="ask-landing-suggestions-label">
                    Try asking
                </header>
                <ul>
                    {suggestions.map((q) => (
                        <li key={q}>
                            <button
                                type="button"
                                className="ask-landing-suggestion"
                                onClick={() => onPickQuestion(q)}
                            >
                                <span
                                    className="ask-landing-suggestion-arrow"
                                    aria-hidden="true"
                                >
                                    →
                                </span>
                                <span>{q}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </section>

            <p className="ask-landing-stats">
                1950 – 2006 · 293 editions · 9,582 articles
            </p>
        </div>
    );
};
