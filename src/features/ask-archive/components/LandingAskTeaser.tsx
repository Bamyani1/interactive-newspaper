"use client";

import React, { useEffect, useState } from "react";
import { pickDailyQuestion } from "../data/question-pool";

/**
 * Editorial teaser line for the homepage cinema card — rotates by
 * day-of-year (same for every visitor today, different tomorrow). The
 * anchor deep-links into `/ask?q=<encoded>` so the /ask page can
 * auto-submit the question and stream an answer immediately.
 *
 * The pick runs in a useEffect → useState pair to dodge SSR/CSR
 * hydration mismatch. A `.cinema-ask-teaser-slot` wrapper reserves
 * vertical space pre-hydration so the CTA row below it doesn't jump
 * by one line-height once the question lands.
 */
export const LandingAskTeaser: React.FC = () => {
    const [question, setQuestion] = useState<string | null>(null);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot post-hydration pick
        setQuestion(pickDailyQuestion(new Date()));
    }, []);

    return (
        <div className="cinema-ask-teaser-slot">
            {question ? (
                <a
                    href={`/ask?q=${encodeURIComponent(question)}`}
                    className="cinema-ask-teaser"
                >
                    <span className="cinema-ask-teaser-label">
                        Try asking
                    </span>
                    <span className="cinema-ask-teaser-text">
                        &ldquo;{question}&rdquo;
                    </span>
                    <span
                        className="cinema-ask-teaser-arrow"
                        aria-hidden="true"
                    >
                        →
                    </span>
                </a>
            ) : null}
        </div>
    );
};
