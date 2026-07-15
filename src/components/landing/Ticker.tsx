"use client";

import React, { useEffect } from "react";

export interface TickerItem {
    text: string;
    year: string;
}

interface TickerProps {
    items: TickerItem[];
    reverse?: boolean; // Default false (top)
}

/**
 * Hook to handle the WAAPI animation for the ticker.
 * Recovers the logic from the original page.tsx.
 */
export function useTickerAnimation() {
    useEffect(() => {
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let disposeAnimations = () => {};
        let resizeFrame = 0;
        let disposed = false;

        const setupAnimations = () => {
            disposeAnimations();

            const cleanup: Array<() => void> = [];
            const animations: Animation[] = [];
            const rafMap = new WeakMap<Animation, number>();
            const tickers = Array.from(
                document.querySelectorAll<HTMLElement>(".cinema-ticker"),
            );

            if (reducedMotion.matches) {
                tickers.forEach((ticker) => {
                    const track = ticker.querySelector<HTMLElement>(".cinema-ticker-track");
                    if (!track) return;
                    track.style.transform = "none";
                    track.style.willChange = "auto";
                });
                disposeAnimations = () => {};
                return;
            }

            const tweenPlaybackRate = (animation: Animation, to: number, duration = 220) => {
                const from = animation.playbackRate || 1;
                const start = performance.now();
                const step = (now: number) => {
                    const progress = Math.min((now - start) / duration, 1);
                    animation.playbackRate = from + (to - from) * progress;
                    if (progress < 1) {
                        rafMap.set(animation, requestAnimationFrame(step));
                    }
                };

                const previousFrame = rafMap.get(animation);
                if (previousFrame) cancelAnimationFrame(previousFrame);
                rafMap.set(animation, requestAnimationFrame(step));
            };

            tickers.forEach((ticker) => {
                const track = ticker.querySelector<HTMLElement>(".cinema-ticker-track");
                const sequence = ticker.querySelector<HTMLElement>(".cinema-ticker-sequence");
                if (!track || !sequence || typeof track.animate !== "function") return;

                const distance = sequence.getBoundingClientRect().width;
                if (distance <= 0) return;

                track.style.transform = "";
                track.style.willChange = "transform";

                const animation = track.animate(
                    [
                        { transform: "translateX(0)" },
                        { transform: `translateX(-${distance}px)` },
                    ],
                    {
                        duration: 90_000,
                        iterations: Infinity,
                        easing: "linear",
                        direction: track.classList.contains("cinema-ticker-reverse")
                            ? "reverse"
                            : "normal",
                    },
                );
                animations.push(animation);

                const handleEnter = () => tweenPlaybackRate(animation, 0.5);
                const handleLeave = () => tweenPlaybackRate(animation, 1);
                ticker.addEventListener("mouseenter", handleEnter);
                ticker.addEventListener("mouseleave", handleLeave);

                cleanup.push(() => {
                    ticker.removeEventListener("mouseenter", handleEnter);
                    ticker.removeEventListener("mouseleave", handleLeave);
                    const previousFrame = rafMap.get(animation);
                    if (previousFrame) cancelAnimationFrame(previousFrame);
                    animation.cancel();
                    track.style.willChange = "";
                });
            });

            const cta = document.querySelector<HTMLElement>(".cinema-btn");
            if (cta) {
                const halt = () => animations.forEach((animation) => tweenPlaybackRate(animation, 0, 160));
                const resume = () => animations.forEach((animation) => tweenPlaybackRate(animation, 1, 240));
                cta.addEventListener("mouseenter", halt);
                cta.addEventListener("mouseleave", resume);
                cleanup.push(() => {
                    cta.removeEventListener("mouseenter", halt);
                    cta.removeEventListener("mouseleave", resume);
                });
            }

            disposeAnimations = () => cleanup.forEach((cleanupAnimation) => cleanupAnimation());
        };

        const scheduleSetup = () => {
            if (resizeFrame) cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(setupAnimations);
        };

        reducedMotion.addEventListener("change", scheduleSetup);
        window.addEventListener("resize", scheduleSetup);
        void (document.fonts?.ready ?? Promise.resolve()).then(() => {
            if (!disposed) setupAnimations();
        });

        return () => {
            disposed = true;
            reducedMotion.removeEventListener("change", scheduleSetup);
            window.removeEventListener("resize", scheduleSetup);
            if (resizeFrame) cancelAnimationFrame(resizeFrame);
            disposeAnimations();
        };
    }, []);
}

export function Ticker({ items, reverse = false }: TickerProps) {
    return (
        <div
            className={`cinema-ticker ${reverse ? "cinema-ticker-bottom" : "cinema-ticker-top"}`}
            aria-hidden={reverse || undefined}
        >
            <div className={`cinema-ticker-track ${reverse ? "cinema-ticker-reverse" : ""}`}>
                <div className="cinema-ticker-sequence" role="list" aria-label="Ohio Wesleyan milestones">
                    {items.map((item, index) => (
                        <div key={`primary-${index}`} className="cinema-ticker-item" role="listitem">
                            {item.text}
                            <span className="cinema-ticker-year">{item.year}</span>
                        </div>
                    ))}
                </div>
                <div className="cinema-ticker-sequence" aria-hidden="true">
                    {items.map((item, index) => (
                        <div key={`duplicate-${index}`} className="cinema-ticker-item">
                            {item.text}
                            <span className="cinema-ticker-year">{item.year}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
