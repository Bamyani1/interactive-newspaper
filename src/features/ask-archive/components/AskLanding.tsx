"use client";

import React, { useMemo } from "react";
import {
    getQuestionPrompt,
    pickDailyQuestion,
    pickSuggestions,
} from "../data/question-pool";

interface AskLandingProps {
    /** Fire the given question against the live /api/ask flow. */
    onPickQuestion: (question: string) => void;
    /** Keep suggestions visible but inert while a saved session restores. */
    disabled?: boolean;
    /** UTC date seed rendered by the route server component. */
    suggestionDate?: string;
}

export const AskLanding: React.FC<AskLandingProps> = ({
    onPickQuestion,
    disabled = false,
    suggestionDate = "2000-01-01",
}) => {
    // Exclude whatever the homepage teaser is pinning today so a reader
    // arriving from it isn't offered the same question twice.
    const suggestions = useMemo(() => {
        const date = new Date(`${suggestionDate}T12:00:00.000Z`);
        return pickSuggestions(date, pickDailyQuestion(date));
    }, [suggestionDate]);

    return (
        <div className="ask-landing">
            <div className="ask-landing-intro">
                <p className="ask-landing-kicker">
                    Primary-source research{" "}
                    <span aria-hidden="true">·</span> 1950–2006
                </p>
                <h1 className="ask-landing-title">
                    What did students <em>say?</em>
                </h1>

                <p className="ask-landing-lede">
                    Search more than five decades of <em>The Transcript</em>.
                    Compare eras, trace campus debates, and uncover everyday
                    student life.
                </p>

                <p className="ask-landing-stats">
                    Answers cite primary sources. Always verify. · 351 editions
                    · 11,705 articles
                </p>
            </div>

            <section
                className="ask-landing-suggestions"
                aria-label="Suggested questions, refreshed daily"
            >
                <ul>
                    {suggestions.map((question, index) => (
                        <li key={question}>
                            <button
                                type="button"
                                className="ask-landing-suggestion"
                                onClick={() => onPickQuestion(question)}
                                disabled={disabled}
                            >
                                <span
                                    className="ask-landing-suggestion-index"
                                    aria-hidden="true"
                                >
                                    {String(index + 1).padStart(2, "0")}
                                </span>
                                <span className="ask-landing-suggestion-copy">
                                    <span className="ask-landing-suggestion-lens">
                                        {getQuestionPrompt(question)?.lens ??
                                            "Explore the archive"}
                                    </span>
                                    <span className="ask-landing-suggestion-question">
                                        {question}
                                    </span>
                                </span>
                                <span
                                    className="ask-landing-suggestion-arrow"
                                    aria-hidden="true"
                                >
                                    →
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
};
