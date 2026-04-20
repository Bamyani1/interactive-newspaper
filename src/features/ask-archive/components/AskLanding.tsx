"use client";

import React, { useEffect, useMemo, useState } from "react";
import { pickSuggestions } from "../data/question-pool";

interface AskLandingProps {
    /** Fire the given question against the live /api/ask flow. */
    onPickQuestion: (question: string) => void;
}

// Excluded from the daily suggestions so the pool doesn't collide with
// any pinned example copy elsewhere on this surface.
const EXCLUDED_FROM_ROTATION = "Tell me about Homecoming in the 1970s.";

const VISITED_KEY = "owu-has-visited-ask";

export const AskLanding: React.FC<AskLandingProps> = ({ onPickQuestion }) => {
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
                Answers cite primary sources. Always verify. · 1950 – 2006 ·
                351 editions · 11,705 articles
            </p>
        </div>
    );
};
