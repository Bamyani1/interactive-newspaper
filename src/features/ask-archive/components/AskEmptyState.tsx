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
            <p className="ask-empty-label">Ask the Research Desk</p>
            <p className="ask-empty-description">
                Ask questions about Ohio Wesleyan history spanning 1950 to
                2006. Answers are grounded in articles from The Transcript
                Archive, with sources you can verify.
            </p>
            {onPickExample ? (
                <ul className="ask-empty-examples">
                    {EXAMPLE_QUESTIONS.map((q) => (
                        <li key={q}>
                            <button
                                type="button"
                                className="ask-empty-example"
                                onClick={() => onPickExample(q)}
                            >
                                {q}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
            <p className="ask-empty-stats">
                Powered by The Transcript Archive
            </p>
        </div>
    );
};
