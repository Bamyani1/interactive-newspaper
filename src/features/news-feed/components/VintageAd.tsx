"use client";

import React from "react";
import type { VintageAd as VintageAdType } from "@/src/types";
import type { AdVariant } from "./AdsBoard";

interface VintageAdProps {
    ad: VintageAdType;
    variant: AdVariant;
}

export const VintageAd: React.FC<VintageAdProps> = ({ ad, variant }) => {
    switch (variant) {
        case 'tiny-liner':
            return <TinyLiner ad={ad} />;
        case 'boxed-notice':
            return <BoxedNotice ad={ad} />;
        case 'mini-display':
            return <MiniDisplay ad={ad} />;
        case 'retail-coupon':
            return <RetailCoupon ad={ad} />;
        case 'service-card':
            return <ServiceCard ad={ad} />;
        case 'bulletin':
            return <Bulletin ad={ad} />;
        case 'marquee':
            return <Marquee ad={ad} />;
        case 'broadsheet':
            return <Broadsheet ad={ad} />;
        case 'editorial-style':
            return <EditorialStyle ad={ad} />;
        case 'showcase':
            return <Showcase ad={ad} />;
    }
};

/* ─── Template Props ────────────────────────────────────────────── */

interface TemplateProps {
    ad: VintageAdType;
}

/* ─── SHORT TIER ────────────────────────────────────────────────── */

/** 1. TinyLiner — Minimal classified listing between rules */
const TinyLiner: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border-t border-b border-[var(--color-text-primary)] p-2">
        <p className="font-typewriter text-xs leading-snug text-[var(--color-text-primary)]">
            <span className="font-bold uppercase font-header tracking-wide">
                {ad.title}
            </span>
            {" — "}
            <span className="whitespace-pre-line">{ad.body}</span>
        </p>
    </div>
);

/** 2. BoxedNotice — Small bordered notice box */
const BoxedNotice: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border-[3px] border-[var(--color-text-primary)] bg-[var(--color-bg-secondary)] p-3 flex flex-col items-center justify-center text-center">
        <h4 className="font-header text-base font-bold uppercase tracking-wider text-[var(--color-text-primary)] mb-1">
            {ad.title}
        </h4>
        <p className="font-typewriter text-xs leading-snug text-[var(--color-text-secondary)] whitespace-pre-line">
            {ad.body}
        </p>
    </div>
);

/** 3. MiniDisplay — Dotted border display ad */
const MiniDisplay: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border-2 border-dotted border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-4 flex flex-col items-center justify-center text-center">
        <h4 className="font-header text-sm font-bold uppercase tracking-[0.3em] text-[var(--color-text-primary)] mb-2">
            {ad.title}
        </h4>
        <p className="font-typewriter text-xs leading-snug text-[var(--color-text-secondary)] whitespace-pre-line">
            {ad.body}
        </p>
    </div>
);

/* ─── MEDIUM TIER ───────────────────────────────────────────────── */

/** 4. RetailCoupon — Dashed coupon with rotated corner label */
const RetailCoupon: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border-2 border-dashed border-[var(--color-text-primary)] bg-[var(--color-bg-secondary)] p-5 relative overflow-hidden flex flex-col">
        <span className="absolute -top-1 -left-6 bg-[var(--color-accent)] text-[var(--color-text-inverse)] text-[8px] font-bold uppercase tracking-wider px-8 py-0.5 rotate-[-35deg] origin-center">
            Clip & Save
        </span>
        <h4 className="font-header text-xl font-black uppercase text-center text-[var(--color-text-primary)] mb-3 mt-2">
            {ad.title}
        </h4>
        <p className="font-typewriter text-xs leading-relaxed text-[var(--color-text-primary)] whitespace-pre-line">
            {ad.body}
        </p>
        <div className="border-t-2 border-dashed border-[var(--color-text-primary)] mt-3 pt-2">
            <p className="font-typewriter text-[9px] uppercase tracking-widest text-center text-[var(--color-text-secondary)]">
                Present this coupon at time of purchase
            </p>
        </div>
    </div>
);

/** 5. ServiceCard — Professional service card with double top rule */
const ServiceCard: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border-t-4 border-double border-[var(--color-text-primary)] bg-[var(--color-bg-primary)] p-4 flex flex-col">
        <h4 className="font-serif text-lg text-center text-[var(--color-text-primary)] mb-2">
            {ad.title}
        </h4>
        <div className="border-t border-[var(--color-border-default)] mb-3" />
        <p className="font-typewriter text-xs leading-relaxed text-[var(--color-text-primary)] whitespace-pre-line">
            {ad.body}
        </p>
    </div>
);

/** 6. Bulletin — Campus bulletin board note, slightly askew */
const Bulletin: React.FC<TemplateProps> = ({ ad }) => (
    <div className="transform rotate-[-1deg] border border-[var(--color-text-primary)] bg-[var(--color-bg-secondary)] p-4 flex flex-col relative">
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[var(--color-accent)] border-2 border-[var(--color-text-primary)] shadow-sm z-10" />
        <h4 className="font-header text-base font-bold uppercase text-[var(--color-text-primary)] mt-2 mb-2">
            {ad.title}
        </h4>
        <p className="font-typewriter text-xs leading-relaxed text-[var(--color-text-primary)] whitespace-pre-line">
            {ad.body}
        </p>
    </div>
);

/** 7. Marquee — Entertainment marquee with star borders */
const Marquee: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border border-[var(--color-text-primary)] bg-[var(--color-bg-secondary)] p-4 flex flex-col text-center">
        <p className="font-header text-xs tracking-[0.4em] text-[var(--color-text-secondary)] mb-2 select-none" aria-hidden="true">
            &#9733; &#9733; &#9733; &#9733; &#9733;
        </p>
        <h4 className="font-header text-xl font-black uppercase tracking-wider text-[var(--color-text-primary)] mb-2">
            {ad.title}
        </h4>
        <p className="font-typewriter text-xs leading-relaxed text-[var(--color-text-primary)] whitespace-pre-line">
            {ad.body}
        </p>
        <p className="font-header text-xs tracking-[0.4em] text-[var(--color-text-secondary)] mt-3 select-none" aria-hidden="true">
            &#9733; &#9733; &#9733; &#9733; &#9733;
        </p>
    </div>
);

/* ─── LONG TIER ─────────────────────────────────────────────────── */

/** 8. Broadsheet — Full display ad with drop cap */
const Broadsheet: React.FC<TemplateProps> = ({ ad }) => {
    const firstChar = ad.body.charAt(0);
    const restBody = ad.body.slice(1);

    return (
        <div className="border-t-4 border-[var(--color-text-primary)] bg-[var(--color-bg-primary)] p-5 flex flex-col">
            <h4 className="font-header text-2xl font-bold uppercase text-center text-[var(--color-text-primary)] mb-2 pb-2 border-b border-[var(--color-text-primary)]">
                {ad.title}
            </h4>
            <div className="font-serif text-sm leading-relaxed text-justify text-[var(--color-text-primary)] whitespace-pre-line mt-2">
                <span className="float-left text-4xl font-bold leading-none mr-1 font-header text-[var(--color-text-primary)]">
                    {firstChar}
                </span>
                {restBody}
            </div>
        </div>
    );
};

/** 9. EditorialStyle — Advertorial that blends with newspaper copy */
const EditorialStyle: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-5 flex flex-col">
        <p className="font-header text-[9px] uppercase tracking-[0.4em] text-center text-[var(--color-text-secondary)] mb-3">
            &mdash; Advertisement &mdash;
        </p>
        <h4 className="font-serif text-2xl text-center text-[var(--color-text-primary)] mb-3 leading-tight">
            {ad.title}
        </h4>
        <p className="font-serif text-sm leading-relaxed text-justify text-[var(--color-text-primary)] whitespace-pre-line">
            {ad.body}
        </p>
    </div>
);

/** 10. Showcase — Feature display with ornamental box-drawing corners */
const Showcase: React.FC<TemplateProps> = ({ ad }) => (
    <div className="bg-[var(--color-bg-secondary)] p-6 flex flex-col text-center relative">
        {/* Ornamental corners */}
        <span className="absolute top-1 left-2 font-mono text-2xl leading-none text-[var(--color-text-secondary)] select-none" aria-hidden="true">&#9556;</span>
        <span className="absolute top-1 right-2 font-mono text-2xl leading-none text-[var(--color-text-secondary)] select-none" aria-hidden="true">&#9559;</span>
        <span className="absolute bottom-1 left-2 font-mono text-2xl leading-none text-[var(--color-text-secondary)] select-none" aria-hidden="true">&#9562;</span>
        <span className="absolute bottom-1 right-2 font-mono text-2xl leading-none text-[var(--color-text-secondary)] select-none" aria-hidden="true">&#9565;</span>

        <h4 className="font-header text-2xl font-bold uppercase tracking-wider text-[var(--color-text-primary)] mt-3 mb-2">
            {ad.title}
        </h4>
        <p className="font-mono text-xs text-[var(--color-text-secondary)] mb-3 select-none" aria-hidden="true">
            &#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;
        </p>
        <p className="font-typewriter text-sm leading-relaxed text-[var(--color-text-primary)] whitespace-pre-line">
            {ad.body}
        </p>
    </div>
);
