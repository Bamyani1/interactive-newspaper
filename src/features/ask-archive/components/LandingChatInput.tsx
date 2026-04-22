"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

/**
 * Landing-page chat entry. User types a question and submits — we deep-link
 * into /ask?q=<encoded> so the Ask page auto-submits and streams an answer
 * immediately (same contract the LandingAskTeaser anchor uses). An empty
 * submit falls through to /ask so the page is still reachable.
 */
export const LandingChatInput: React.FC = () => {
    const router = useRouter();
    const [value, setValue] = useState("");

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const trimmed = value.trim();
        router.push(trimmed ? `/ask?q=${encodeURIComponent(trimmed)}` : "/ask");
    };

    return (
        <form className="cinema-chat-form" onSubmit={handleSubmit}>
            <label htmlFor="landing-chat-input" className="cinema-chat-label">
                Ask the Archive
            </label>
            <div className="cinema-chat-input-row">
                <input
                    id="landing-chat-input"
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="What would you like to know?"
                    className="cinema-chat-input"
                    autoComplete="off"
                />
                <button
                    type="submit"
                    className="cinema-chat-submit"
                    aria-label="Ask"
                >
                    <ArrowRight size={18} />
                </button>
            </div>
        </form>
    );
};
