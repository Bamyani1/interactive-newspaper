"use client";

import React, { useMemo } from "react";
import { pickSuggestions } from "../data/question-pool";

interface AskLandingProps {
    /** Fire the given question against the live /api/ask flow. */
    onPickQuestion: (question: string) => void;
    /** Keep suggestions visible but inert while a saved session restores. */
    disabled?: boolean;
    /** UTC date seed rendered by the route server component. */
    suggestionDate?: string;
}

// Excluded from the daily suggestions so the pool doesn't collide with
// any pinned example copy elsewhere on this surface.
const EXCLUDED_FROM_ROTATION = "Tell me about Homecoming in the 1970s.";

export const AskLanding: React.FC<AskLandingProps> = ({
    onPickQuestion,
    disabled = false,
    suggestionDate = "2000-01-01",
}) => {
    const suggestions = useMemo(
        () =>
            pickSuggestions(
                new Date(`${suggestionDate}T12:00:00.000Z`),
                EXCLUDED_FROM_ROTATION,
            ),
        [suggestionDate],
    );

    return (
        <div className="ask-landing">
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
                                disabled={disabled}
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
