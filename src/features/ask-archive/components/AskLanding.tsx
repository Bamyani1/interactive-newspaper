"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";

interface AskLandingProps {
    /** Fire the given question against the live /api/ask flow. */
    onPickQuestion: (question: string) => void;
    /**
     * True when the hook reports `/api/ask/session` returned `expired:true`.
     * We show a gentle notice at the top of the landing in that case so the
     * user knows why their previous conversation isn't there.
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

const DEMO_QUESTION = "Tell me about Homecoming in the 1970s.";
const DEMO_SOURCES: ReadonlyArray<{
    n: number;
    headline: string;
    date: string;
    category: string;
}> = [
    {
        n: 1,
        headline: "Homecoming pep rally draws 2,000 to the quad",
        date: "Oct 20, 1972",
        category: "News",
    },
    {
        n: 2,
        headline: "Bishops fall 24–17 at homecoming game",
        date: "Oct 27, 1972",
        category: "Sports",
    },
];

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
    // instant paint — they've seen it, don't make them watch the
    // ceremony on every /ask open. The useEffect + setState shape is
    // intentional: reading localStorage in a state initializer would
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
        () => pickSuggestions(new Date(), DEMO_QUESTION),
        [],
    );

    return (
        <div
            className="ask-landing"
            data-animate={animate ? "true" : undefined}
        >
            {expiredBanner ? (
                <div className="ask-landing-banner" role="status">
                    <span className="ask-landing-banner-label">Notice</span>
                    <span>
                        {" "}— your last conversation expired. Starting fresh.
                    </span>
                </div>
            ) : null}

            <p className="ask-landing-dateline">
                Research Desk · Vol. LVI · 1950–2006
            </p>

            <h1 className="ask-landing-title">
                A research desk for the <em>Transcript</em>.
            </h1>

            <p className="ask-landing-lede">
                Ask anything about{" "}
                <strong>
                    56 years, 293 editions, and 9,582 articles
                </strong>{" "}
                of the Ohio Wesleyan student paper. Every answer cites the
                stories you can verify — type a question below, or start from
                the example.
            </p>

            <section
                className="ask-landing-demo"
                aria-label="Example of how an answer looks"
            >
                <header className="ask-landing-demo-label">
                    <span>Example answer</span>
                    <button
                        type="button"
                        className="ask-landing-demo-cta"
                        onClick={() => onPickQuestion(DEMO_QUESTION)}
                    >
                        Ask this
                        <ArrowRight size={12} aria-hidden="true" />
                    </button>
                </header>
                <blockquote className="ask-landing-demo-question">
                    “{DEMO_QUESTION}”
                </blockquote>
                <p className="ask-landing-demo-answer">
                    Homecoming in the 1970s centered on the annual football
                    game against Wittenberg — the &ldquo;Battle for the
                    Bishop&rdquo; — with a Friday bonfire and pep rally that
                    drew several thousand students
                    <sup className="ask-landing-demo-cite">[1]</sup>. The
                    Transcript also covered a Saturday morning float parade
                    down Sandusky Street and the crowning of a Homecoming court
                    at halftime
                    <sup className="ask-landing-demo-cite">[2]</sup>.
                </p>
                <ul className="ask-landing-demo-sources">
                    {DEMO_SOURCES.map((s) => (
                        <li key={s.n} className="ask-landing-demo-source">
                            <span className="ask-landing-demo-source-num">
                                [{s.n}]
                            </span>
                            <span className="ask-landing-demo-source-head">
                                {s.headline}
                            </span>
                            <span className="ask-landing-demo-source-meta">
                                {s.date} · {s.category}
                            </span>
                        </li>
                    ))}
                </ul>
            </section>

            <section
                className="ask-landing-suggestions"
                aria-label="Suggested questions, refreshed daily"
            >
                <header className="ask-landing-suggestions-label">
                    Or try one of these — refreshed daily
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
        </div>
    );
};
