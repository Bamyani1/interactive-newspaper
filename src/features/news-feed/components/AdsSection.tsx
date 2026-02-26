"use client";

import React, { useMemo, useState } from "react";
import type { VintageAd, AdCategory } from "@/src/types";

// ── Variant Types & Mapping ─────────────────────────────────────────

type AdVariant =
    | "tiny-liner" | "boxed-notice" | "mini-display"
    | "retail-coupon" | "service-card" | "bulletin" | "marquee"
    | "broadsheet" | "editorial-style" | "showcase";

const SHORT_VARIANTS: AdVariant[] = ["tiny-liner", "boxed-notice", "mini-display"];
const MEDIUM_VARIANTS: AdVariant[] = ["retail-coupon", "service-card", "bulletin", "marquee"];
const LONG_VARIANTS: AdVariant[] = ["broadsheet", "editorial-style", "showcase"];

const CATEGORY_VARIANT_MAP: Partial<Record<AdCategory, AdVariant>> = {
    "Entertainment": "marquee",
    "Retail": "retail-coupon",
    "Food & Drink": "retail-coupon",
    "Services": "service-card",
    "Jobs": "service-card",
    "Greek Life": "bulletin",
    "Events": "bulletin",
    "Housing": "boxed-notice",
    "Education": "broadsheet",
};

// ── Variant Assignment ──────────────────────────────────────────────

function assignVariants(ads: VintageAd[]): AdVariant[] {
    const result: AdVariant[] = [];
    const tierCounters = { short: 0, medium: 0, long: 0 };

    for (const ad of ads) {
        const len = ad.body.length;
        let variant: AdVariant | null = null;

        // 1. Try category match
        if (ad.category && CATEGORY_VARIANT_MAP[ad.category]) {
            const candidate = CATEGORY_VARIANT_MAP[ad.category]!;
            // 2. Prevent monotony — skip if same variant 2+ times in a row
            const recent = result.slice(-2);
            if (recent.length < 2 || !recent.every(v => v === candidate)) {
                variant = candidate;
            }
        }

        // 3. Fallback to body-length tier cycling
        if (!variant) {
            if (len < 80) {
                variant = SHORT_VARIANTS[tierCounters.short % SHORT_VARIANTS.length];
                tierCounters.short++;
            } else if (len <= 350) {
                variant = MEDIUM_VARIANTS[tierCounters.medium % MEDIUM_VARIANTS.length];
                tierCounters.medium++;
            } else {
                variant = LONG_VARIANTS[tierCounters.long % LONG_VARIANTS.length];
                tierCounters.long++;
            }
        }

        result.push(variant);
    }

    return result;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Resolves enriched displayText with fallback to raw body */
function adText(ad: VintageAd, maxLen?: number): string {
    const text = ad.displayText || ad.body;
    return maxLen ? text.slice(0, maxLen) : text;
}

// ── Shared Sub-components ───────────────────────────────────────────

function CategoryBadge({ category }: { category: string }) {
    return (
        <span className="inline-block self-start px-2 py-0.5 text-[10px] uppercase tracking-widest font-semibold border border-[var(--color-border-default)] text-[var(--color-text-secondary)]">
            {category}
        </span>
    );
}

function AdContactFooter({ ad }: { ad: VintageAd }) {
    if (!ad.phone && !ad.address && !ad.price) return null;
    return (
        <div className="border-t border-[var(--color-border-default)] pt-2 mt-auto flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-typewriter text-[var(--color-text-secondary)]">
            {ad.phone && <span>{ad.phone}</span>}
            {ad.address && <span>{ad.address}</span>}
            {ad.price && <span className="font-bold">{ad.price}</span>}
        </div>
    );
}

// ── Template Props ──────────────────────────────────────────────────

interface TemplateProps {
    ad: VintageAd;
}

// ── SHORT TIER ──────────────────────────────────────────────────────

/** 1. TinyLiner — Rules top/bottom, inline text */
const TinyLiner: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border-t border-b border-[var(--color-text-primary)]/30 bg-[var(--color-bg-secondary)]/60 p-2">
        <p className="font-typewriter text-xs leading-snug text-[var(--color-text-primary)]">
            <span className="font-semibold uppercase font-header tracking-wide">
                {ad.title}
            </span>
            <span className="text-[var(--color-accent)] mx-1">&mdash;</span>
            <span className="whitespace-pre-line">{adText(ad)}</span>
            {ad.phone && (
                <span className="text-[var(--color-text-secondary)]"> {ad.phone}</span>
            )}
        </p>
    </div>
);

/** 2. BoxedNotice — Thick 3px border, centered */
const BoxedNotice: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border border-[var(--color-border-default)] border-t-2 border-t-[var(--stroke-accent-soft)] bg-[var(--color-bg-secondary)]/60 p-3 flex flex-col items-center justify-center text-center gap-2">
        {ad.category && <CategoryBadge category={ad.category} />}
        <h4 className="font-header text-base font-bold uppercase tracking-wider text-[var(--color-text-primary)]">
            {ad.title}
        </h4>
        <p className="font-typewriter text-xs leading-snug text-[var(--color-text-secondary)] whitespace-pre-line">
            {adText(ad)}
        </p>
        <AdContactFooter ad={ad} />
    </div>
);

/** 3. MiniDisplay — Dotted border, centered */
const MiniDisplay: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border border-dotted border-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)]/60 p-4 flex flex-col items-center justify-center text-center gap-2">
        <h4 className="font-header text-sm font-bold uppercase tracking-widest text-[var(--color-text-primary)]">
            {ad.title}
        </h4>
        <p className="font-typewriter text-xs leading-snug text-[var(--color-text-secondary)] whitespace-pre-line">
            {adText(ad)}
        </p>
        <AdContactFooter ad={ad} />
    </div>
);

// ── MEDIUM TIER ─────────────────────────────────────────────────────

/** 4. RetailCoupon — Dashed border, "Clip & Save" ribbon */
const RetailCoupon: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border border-dashed border-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)]/60 p-5 relative overflow-hidden flex flex-col gap-2">
        <span className="absolute -top-1 -left-6 bg-[var(--color-accent)] text-[var(--color-text-inverse)] text-[8px] font-bold uppercase tracking-wider px-8 py-0.5 rotate-[-35deg] origin-center">
            Clip & Save
        </span>
        <h4 className="font-header text-lg font-bold uppercase text-center text-[var(--color-text-primary)] mt-2">
            {ad.title}
        </h4>
        {ad.price && (
            <p className="font-header text-base font-bold text-center text-[var(--color-accent)]">
                {ad.price}
            </p>
        )}
        <p className="font-typewriter text-xs leading-relaxed text-[var(--color-text-primary)] whitespace-pre-line">
            {adText(ad)}
        </p>
        <AdContactFooter ad={ad} />
        <div className="border-t border-dashed border-[var(--color-text-secondary)] pt-2">
            <p className="font-typewriter text-[9px] uppercase tracking-widest text-center text-[var(--color-text-secondary)]">
                Present this coupon at time of purchase
            </p>
        </div>
    </div>
);

/** 5. ServiceCard — Double top rule, professional */
const ServiceCard: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border-t-2 border-t-[var(--stroke-accent-soft)] border-b border-b-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/60 p-4 flex flex-col gap-2">
        {ad.category && <CategoryBadge category={ad.category} />}
        <h4 className="font-header text-lg font-semibold text-center text-[var(--color-text-primary)]">
            {ad.title}
        </h4>
        <div className="border-t border-[var(--color-border-default)]" />
        <p className="font-typewriter text-xs leading-relaxed text-[var(--color-text-primary)] whitespace-pre-line">
            {adText(ad)}
        </p>
        <AdContactFooter ad={ad} />
    </div>
);

/** 6. Bulletin — Tilted with pushpin */
const Bulletin: React.FC<TemplateProps> = ({ ad }) => (
    <div className="transform rotate-[-1deg] border border-[var(--color-text-primary)]/25 bg-[var(--color-bg-secondary)]/60 p-4 flex flex-col gap-2 relative" style={{ boxShadow: "var(--shadow-paper)" }}>
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[var(--color-accent)] border border-[var(--color-text-primary)]/40 shadow-sm z-10" />
        {ad.category && <CategoryBadge category={ad.category} />}
        <h4 className="font-header text-base font-bold uppercase text-[var(--color-text-primary)] mt-2">
            {ad.title}
        </h4>
        <p className="font-typewriter text-xs leading-relaxed text-[var(--color-text-primary)] whitespace-pre-line">
            {adText(ad)}
        </p>
        <AdContactFooter ad={ad} />
    </div>
);

/** 7. Marquee — Star borders */
const Marquee: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border border-[var(--color-text-primary)]/25 border-t-2 border-t-[var(--stroke-accent-soft)] border-b-2 border-b-[var(--stroke-accent-soft)] bg-[var(--color-bg-secondary)]/60 p-4 flex flex-col text-center gap-2">
        <p className="font-header text-xs tracking-[0.4em] text-[var(--color-accent)] opacity-50 select-none" aria-hidden="true">
            &#9733; &#9733; &#9733; &#9733; &#9733;
        </p>
        <h4 className="font-header text-xl font-bold uppercase tracking-wider text-[var(--color-text-primary)]">
            {ad.title}
        </h4>
        {ad.price && (
            <p className="font-typewriter text-sm font-semibold text-[var(--color-text-secondary)]">
                Admission: {ad.price}
            </p>
        )}
        <p className="font-typewriter text-xs leading-relaxed text-[var(--color-text-primary)] whitespace-pre-line">
            {adText(ad)}
        </p>
        <AdContactFooter ad={ad} />
        <p className="font-header text-xs tracking-[0.4em] text-[var(--color-accent)] opacity-50 select-none" aria-hidden="true">
            &#9733; &#9733; &#9733; &#9733; &#9733;
        </p>
    </div>
);

// ── LONG TIER ───────────────────────────────────────────────────────

/** 8. Broadsheet — Drop cap, justified text */
const Broadsheet: React.FC<TemplateProps> = ({ ad }) => {
    const text = adText(ad);
    const firstChar = text.charAt(0);
    const restText = text.slice(1);

    return (
        <div className="border-t-2 border-t-[var(--color-accent)] bg-[var(--color-bg-secondary)]/60 p-5 flex flex-col gap-2">
            {ad.category && <CategoryBadge category={ad.category} />}
            <h4 className="font-header text-2xl font-bold uppercase text-center text-[var(--color-text-primary)] pb-2 border-b border-[var(--color-text-primary)]/30">
                {ad.title}
            </h4>
            <div className="font-body text-sm leading-relaxed text-justify text-[var(--color-text-primary)] whitespace-pre-line">
                <span className="float-left text-3xl font-bold leading-none mr-1 font-header text-[var(--color-accent)]">
                    {firstChar}
                </span>
                {restText}
            </div>
            <AdContactFooter ad={ad} />
        </div>
    );
};

/** 9. EditorialStyle — "— Advertisement —" header */
const EditorialStyle: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border border-[var(--color-text-secondary)]/40 border-b-2 border-b-[var(--stroke-accent-soft)] bg-[var(--color-bg-secondary)]/60 p-5 flex flex-col gap-2">
        <p className="font-header text-[10px] uppercase tracking-[0.4em] text-center text-[var(--color-accent)] opacity-60">
            &mdash; Advertisement &mdash;
        </p>
        <h4 className="font-header text-2xl text-center text-[var(--color-text-primary)] leading-tight">
            {ad.title}
        </h4>
        <p className="font-body text-sm leading-relaxed text-justify text-[var(--color-text-primary)] whitespace-pre-line">
            {adText(ad)}
        </p>
        {(ad.phone || ad.address || ad.price) && (
            <div className="border-t border-[var(--color-text-secondary)]/30 pt-2 mt-auto flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-typewriter text-[var(--color-text-secondary)]">
                {ad.address && <span className="font-semibold">{ad.address}</span>}
                {ad.phone && <span>{ad.phone}</span>}
                {ad.price && <span>{ad.price}</span>}
            </div>
        )}
    </div>
);

/** 10. Showcase — Box-drawing corner ornaments */
const Showcase: React.FC<TemplateProps> = ({ ad }) => (
    <div className="border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/60 p-6 flex flex-col text-center gap-2 relative">
        <span className="absolute top-1 left-2 font-mono text-2xl leading-none text-[var(--color-accent)] opacity-40 select-none" aria-hidden="true">&#9556;</span>
        <span className="absolute top-1 right-2 font-mono text-2xl leading-none text-[var(--color-accent)] opacity-40 select-none" aria-hidden="true">&#9559;</span>
        <span className="absolute bottom-1 left-2 font-mono text-2xl leading-none text-[var(--color-accent)] opacity-40 select-none" aria-hidden="true">&#9562;</span>
        <span className="absolute bottom-1 right-2 font-mono text-2xl leading-none text-[var(--color-accent)] opacity-40 select-none" aria-hidden="true">&#9565;</span>

        {ad.category && <CategoryBadge category={ad.category} />}
        <h4 className="font-header text-2xl font-bold uppercase tracking-wider text-[var(--color-text-primary)] mt-2">
            {ad.title}
        </h4>
        <p className="font-mono text-xs text-[var(--color-accent)] opacity-30 select-none" aria-hidden="true">
            &#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;&#9552;
        </p>
        <p className="font-typewriter text-sm leading-relaxed text-[var(--color-text-primary)] whitespace-pre-line">
            {adText(ad)}
        </p>
        <AdContactFooter ad={ad} />
    </div>
);

// ── Ad Image ────────────────────────────────────────────────────────

function AdImage({ ad, compact }: { ad: VintageAd; compact?: boolean }) {
    if (!ad.imageUrls || ad.imageUrls.length === 0) return null;
    return (
        <div className="w-full overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- ad images have unknown dimensions */}
            <img
                src={ad.imageUrls[0]}
                alt={`${ad.title} advertisement`}
                className={`w-full h-auto object-contain ${compact ? "max-h-32" : "max-h-64"}`}
                loading="lazy"
            />
        </div>
    );
}

// ── DisplayAd Dispatcher ────────────────────────────────────────────

const SHORT_TIER: ReadonlySet<AdVariant> = new Set(["tiny-liner", "boxed-notice", "mini-display"]);

function DisplayAd({ ad, variant }: { ad: VintageAd; variant: AdVariant }) {
    const image = <AdImage ad={ad} compact={SHORT_TIER.has(variant)} />;
    switch (variant) {
        case "tiny-liner":     return <>{image}<TinyLiner ad={ad} /></>;
        case "boxed-notice":   return <>{image}<BoxedNotice ad={ad} /></>;
        case "mini-display":   return <>{image}<MiniDisplay ad={ad} /></>;
        case "retail-coupon":  return <>{image}<RetailCoupon ad={ad} /></>;
        case "service-card":   return <>{image}<ServiceCard ad={ad} /></>;
        case "bulletin":       return <>{image}<Bulletin ad={ad} /></>;
        case "marquee":        return <>{image}<Marquee ad={ad} /></>;
        case "broadsheet":     return <>{image}<Broadsheet ad={ad} /></>;
        case "editorial-style": return <>{image}<EditorialStyle ad={ad} /></>;
        case "showcase":       return <>{image}<Showcase ad={ad} /></>;
    }
}

const INITIAL_VISIBLE = 4;

// ── Ads Section (display ads only) ──────────────────────────────────

interface AdsSectionProps {
    displayAds: VintageAd[];
}

export const AdsSection: React.FC<AdsSectionProps> = ({ displayAds }) => {
    const [expanded, setExpanded] = useState(false);
    const variants = useMemo(() => assignVariants(displayAds), [displayAds]);
    const visibleAds = expanded ? displayAds : displayAds.slice(0, INITIAL_VISIBLE);

    if (displayAds.length === 0) {
        return (
            <section className="p-10 text-center border border-dashed rounded-sm opacity-70">
                <p className="font-header text-xl uppercase tracking-widest">
                    No advertisements available
                </p>
            </section>
        );
    }

    return (
        <section className="w-full">
            <div className="flex items-center justify-between border-b pb-3 mb-6">
                <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.35em] opacity-70">
                        Advertisements
                    </p>
                    <h3 className="font-header text-2xl md:text-3xl leading-tight">
                        Display Ads
                    </h3>
                </div>
                <span className="px-3 py-1 border border-[var(--color-text-primary)] text-xs uppercase tracking-widest font-semibold">
                    {displayAds.length} {displayAds.length === 1 ? "Ad" : "Ads"}
                </span>
            </div>

            <div className="columns-1 sm:columns-2 gap-4 md:gap-5 mb-8">
                {visibleAds.map((ad, idx) => (
                    <div
                        key={`display-${ad.title}-${idx}`}
                        className="break-inside-avoid mb-4 md:mb-5"
                    >
                        <DisplayAd ad={ad} variant={variants[idx]} />
                    </div>
                ))}
            </div>

            {displayAds.length > INITIAL_VISIBLE && !expanded && (
                <button
                    onClick={() => setExpanded(true)}
                    className="w-full py-3 border border-[var(--color-text-primary)] text-xs uppercase tracking-[0.25em] font-header font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                >
                    See All {displayAds.length} Ads
                </button>
            )}
        </section>
    );
};

// ── Classifieds Section (standalone) ────────────────────────────────

interface ClassifiedsSectionProps {
    classifiedAds: VintageAd[];
}

export const ClassifiedsSection: React.FC<ClassifiedsSectionProps> = ({ classifiedAds }) => {
    const [expanded, setExpanded] = useState(false);
    const variants = useMemo(() => assignVariants(classifiedAds), [classifiedAds]);
    const visibleAds = expanded ? classifiedAds : classifiedAds.slice(0, INITIAL_VISIBLE);

    if (classifiedAds.length === 0) {
        return (
            <section className="p-10 text-center border border-dashed rounded-sm opacity-70">
                <p className="font-header text-xl uppercase tracking-widest">
                    No classifieds available
                </p>
            </section>
        );
    }

    return (
        <section className="w-full">
            <div className="flex items-center justify-between border-b pb-3 mb-6">
                <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.35em] opacity-70">
                        Classifieds
                    </p>
                    <h3 className="font-header text-2xl md:text-3xl leading-tight">
                        Classified Listings
                    </h3>
                </div>
                <span className="px-3 py-1 border border-[var(--color-text-primary)] text-xs uppercase tracking-widest font-semibold">
                    {classifiedAds.length} {classifiedAds.length === 1 ? "Listing" : "Listings"}
                </span>
            </div>

            <div className="columns-1 sm:columns-2 gap-4 md:gap-5 mb-8">
                {visibleAds.map((ad, idx) => (
                    <div
                        key={`classified-${ad.title}-${idx}`}
                        className="break-inside-avoid mb-4 md:mb-5"
                    >
                        <DisplayAd ad={ad} variant={variants[idx]} />
                    </div>
                ))}
            </div>

            {classifiedAds.length > INITIAL_VISIBLE && !expanded && (
                <button
                    onClick={() => setExpanded(true)}
                    className="w-full py-3 border border-[var(--color-text-primary)] text-xs uppercase tracking-[0.25em] font-header font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                >
                    See All {classifiedAds.length} Listings
                </button>
            )}
        </section>
    );
};
