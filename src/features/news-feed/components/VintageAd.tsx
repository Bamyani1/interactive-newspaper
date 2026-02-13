"use client";

import React from "react";
import type { VintageAd as VintageAdType } from "@/src/types";

interface VintageAdProps {
    ad: VintageAdType;
    variant?: 'cinema' | 'retail' | 'classified';
}

export const VintageAd: React.FC<VintageAdProps> = ({ ad, variant = 'retail' }) => {

    // VARIANT 1: CINEMA (Inverted Black Box)
    if (variant === 'cinema') {
        return (
            <div className="bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] p-4 relative shadow-sm border border-[var(--color-border-default)]">
                {/* Starburst */}
                <div className="absolute -top-3 -right-3 bg-[var(--color-text-primary)] text-[var(--color-text-inverse)] w-12 h-12 rounded-full flex items-center justify-center font-bold text-[8px] uppercase transform rotate-12 border-2 border-[var(--color-text-inverse)] z-10 shadow-sm leading-none text-center">
                    Held<br />Over!
                </div>

                <div className="border border-[color-mix(in_srgb,var(--color-text-primary)_80%,transparent)] p-1 mb-3 text-center">
                    {ad.tag && <span className="block text-[8px] uppercase tracking-widest mb-1 text-[var(--color-text-secondary)]">{ad.tag}</span>}
                    <h4 className="font-header text-xl uppercase tracking-wider leading-none text-[var(--color-text-primary)]">
                        {ad.title}
                    </h4>
                </div>

                <p className="font-header italic text-xs text-center text-[var(--color-text-secondary)] mb-3 leading-tight border-b border-[var(--color-border-default)] pb-2">
                    {ad.subtitle || 'The most exciting film of the year!'}
                </p>

                <p className="font-typewriter text-xs text-justify leading-snug mb-3 opacity-90">
                    {ad.body}
                </p>

                <div className="text-center">
                    {ad.price && <span className="block font-bold text-lg text-[var(--color-accent)] font-header">{ad.price}</span>}
                    {ad.footer && <span className="text-[9px] uppercase tracking-widest text-[var(--color-text-secondary)]">{ad.footer}</span>}
                </div>
            </div>
        );
    }

    // VARIANT 2: RETAIL (Double Border / Coupon)
    if (variant === 'retail') {
        return (
            <div className="bg-[var(--color-bg-secondary)] border-4 border-double border-[var(--color-border-default)] shadow-sm overflow-hidden flex flex-col h-full relative">
                <div className="absolute top-0 left-0 bg-[var(--color-accent)] text-[var(--color-text-primary)] px-1.5 py-0.5 text-[8px] font-bold uppercase">Coupon</div>

                <div className="p-4 flex flex-col flex-1 bg-[var(--color-bg-primary)]">
                    <div className="text-center mb-3">
                        <h4 className="font-header text-xl font-black uppercase leading-none text-[var(--color-text-primary)] mb-1">
                            {ad.title}
                        </h4>
                        {ad.subtitle && (
                            <p className="font-typewriter text-[10px] uppercase tracking-widest border-b border-[var(--color-text-primary)] pb-1 inline-block">
                                {ad.subtitle}
                            </p>
                        )}
                    </div>

                    <p className="font-typewriter text-xs text-justify leading-relaxed text-[var(--color-text-primary)] mb-4 flex-1">
                        {ad.body}
                    </p>

                    <div className="mt-auto border-t-2 border-dashed border-[color-mix(in_srgb,var(--color-text-primary)_30%,transparent)] pt-2 flex justify-between items-end">
                        {ad.footer && (
                            <span className="text-[9px] uppercase font-bold tracking-widest text-[var(--color-text-secondary)] max-w-[60%] leading-tight">
                                {ad.footer}
                            </span>
                        )}
                        {ad.price && (
                            <span className="font-header text-xl font-black text-[var(--color-text-primary)] transform -rotate-2">
                                {ad.price}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // VARIANT 3: CLASSIFIED (Dense Column)
    return (
        <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] p-3 h-full flex flex-col">
            <div className="border-b-2 border-[var(--color-border-default)] mb-2 pb-1 flex justify-between items-end">
                {ad.tag && <span className="font-header font-bold text-sm uppercase">{ad.tag}</span>}
                <span className="font-serif italic text-[10px]">Sec. B-4</span>
            </div>

            <h4 className="font-bold text-base leading-tight mb-1">{ad.title}</h4>
            <p className="font-typewriter text-[11px] leading-snug text-justify mb-2 flex-1">
                {ad.body}
            </p>

            <div className="mt-auto pt-2 border-t border-[color-mix(in_srgb,var(--color-text-primary)_20%,transparent)] flex justify-between items-center">
                {ad.price && <span className="font-bold text-sm">{ad.price}</span>}
                {ad.footer && <span className="text-[9px] uppercase">{ad.footer}</span>}
            </div>
        </div>
    );
};
