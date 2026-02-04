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
        // Select all tickers on the page
        const tickers = Array.from(document.querySelectorAll<HTMLElement>('.cinema-ticker'));
        const cleanup: Array<() => void> = [];
        const animations: Animation[] = [];
        const rafMap = new WeakMap<Animation, number>();

        const tweenPlaybackRate = (anim: Animation, to: number, dur = 220) => {
            const from = anim.playbackRate || 1;
            const start = performance.now();
            const step = (now: number) => {
                const t = Math.min((now - start) / dur, 1);
                anim.playbackRate = from + (to - from) * t;
                if (t < 1) {
                    const raf = requestAnimationFrame(step);
                    rafMap.set(anim, raf);
                }
            };

            const prev = rafMap.get(anim);
            if (prev) cancelAnimationFrame(prev);
            const raf = requestAnimationFrame(step);
            rafMap.set(anim, raf);
        };

        tickers.forEach((ticker) => {
            const track = ticker.querySelector<HTMLElement>('.cinema-ticker-track');
            if (!track || typeof track.animate !== 'function') return;

            // Disable CSS animation; drive with WAAPI for smooth playbackRate changes
            track.style.animation = 'none';
            track.style.willChange = 'transform';

            const animation = track.animate(
                [
                    { transform: 'translateX(0)' },
                    { transform: 'translateX(-50%)' },
                ],
                {
                    duration: 90000,
                    iterations: Infinity,
                    easing: 'linear',
                    direction: track.classList.contains('cinema-ticker-reverse') ? 'reverse' : 'normal',
                }
            );

            animations.push(animation);

            const handleEnter = () => tweenPlaybackRate(animation, 0.5);
            const handleLeave = () => tweenPlaybackRate(animation, 1);

            ticker.addEventListener('mouseenter', handleEnter);
            ticker.addEventListener('mouseleave', handleLeave);

            cleanup.push(() => {
                ticker.removeEventListener('mouseenter', handleEnter);
                ticker.removeEventListener('mouseleave', handleLeave);
                const prev = rafMap.get(animation);
                if (prev) cancelAnimationFrame(prev);
                animation.cancel();
            });
        });

        // Halt both tickers when hovering the CTA
        const cta = document.querySelector<HTMLElement>('.cinema-btn');
        if (cta) {
            const halt = () => animations.forEach((anim) => tweenPlaybackRate(anim, 0, 160));
            const resume = () => animations.forEach((anim) => tweenPlaybackRate(anim, 1, 240));

            cta.addEventListener('mouseenter', halt);
            cta.addEventListener('mouseleave', resume);
            cleanup.push(() => {
                cta.removeEventListener('mouseenter', halt);
                cta.removeEventListener('mouseleave', resume);
            });
        }

        return () => cleanup.forEach((fn) => fn());
    }, []); // Run once on mount
}

export function Ticker({ items, reverse = false }: TickerProps) {
    return (
        <div className={`cinema-ticker ${reverse ? 'cinema-ticker-bottom' : 'cinema-ticker-top'}`}>
            <div className={`cinema-ticker-track ${reverse ? 'cinema-ticker-reverse' : ''}`}>
                {items.map((item, i) => (
                    <div key={`${reverse ? 'bottom' : 'top'}-${i}`} className="cinema-ticker-item">
                        {item.text}
                        <span className="cinema-ticker-year">{item.year}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
