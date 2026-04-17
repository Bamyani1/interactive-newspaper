"use client";

import React from "react";

const EXAMPLE_QUESTIONS = [
    "What was campus life like during Prohibition?",
    "How did OWU respond to the Vietnam War?",
    "What did Bishop Kennedy say when he visited in 1960?",
    "Tell me about Homecoming traditions in the 1970s.",
];

interface AskEmptyStateProps {
    onPickExample?: (question: string) => void;
}

export const AskEmptyState: React.FC<AskEmptyStateProps> = ({
    onPickExample,
}) => {
    return (
        <div className="ask-empty-state">
            <p className="ask-empty-lede">
                <strong>A research desk for the student paper.</strong> Ask a
                question about fifty-six years of campus history; every answer
                comes with the sources you can verify.
            </p>

            <dl className="ask-empty-stats">
                <div className="ask-empty-stat">
                    <dt>Coverage</dt>
                    <dd>1950–2006</dd>
                </div>
                <div className="ask-empty-stat">
                    <dt>Editions</dt>
                    <dd>293</dd>
                </div>
                <div className="ask-empty-stat">
                    <dt>Articles</dt>
                    <dd>9,582</dd>
                </div>
            </dl>

            {onPickExample ? (
                <div className="ask-empty-prompts">
                    <p className="ask-empty-prompts-label">Try asking</p>
                    <ul className="ask-empty-examples">
                        {EXAMPLE_QUESTIONS.map((q) => (
                            <li key={q}>
                                <button
                                    type="button"
                                    className="ask-empty-example"
                                    onClick={() => onPickExample(q)}
                                >
                                    <span
                                        className="ask-empty-example-arrow"
                                        aria-hidden="true"
                                    >
                                        →
                                    </span>
                                    <span>{q}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
};
