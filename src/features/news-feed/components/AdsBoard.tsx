"use client";

import React from "react";
import { motion } from "framer-motion";
import { VintageAd } from "./VintageAd";
import type { VintageAd as VintageAdType } from "@/src/types";
import { fadeUp, staggerContainer, TRANSITIONS } from "@/shared/motion/motionTokens";

interface AdsBoardProps {
    ads: VintageAdType[];
}

const VARIANTS: Array<'retail' | 'cinema' | 'classified'> = [
    "retail",
    "cinema",
    "classified",
];

export const AdsBoard: React.FC<AdsBoardProps> = ({ ads }) => {
    const gridVariants = staggerContainer(0.1, 0.1);
    const cardVariants = fadeUp(14);

    if (!ads?.length) {
        return (
            <section className="p-10 text-center border border-dashed rounded-md opacity-70">
                <p className="font-header text-xl uppercase tracking-widest">
                    No ads available
                </p>
                <p className="font-typewriter text-sm mt-2">
                    Check back for classifieds, coupons, and campus specials.
                </p>
            </section>
        );
    }

    return (
        <section className="w-full">
            <motion.div
                className="flex items-center justify-between border-b pb-3 mb-6"
                variants={fadeUp(12)}
                initial="hidden"
                animate="show"
                transition={TRANSITIONS.base}
            >
                <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.35em] opacity-70">
                        Ads & Notices
                    </p>
                    <h3 className="font-header text-2xl md:text-3xl leading-tight">
                        Ad Board
                    </h3>
                </div>
                <span className="px-3 py-1 border border-[var(--color-text-primary)] text-xs uppercase tracking-widest font-semibold">
                    {ads.length} {ads.length === 1 ? "Listing" : "Listings"}
                </span>
            </motion.div>

            <motion.div
                className="grid gap-4 md:gap-6 sm:grid-cols-2"
                variants={gridVariants}
                initial="hidden"
                animate="show"
            >
                {ads.map((ad, idx) => (
                    <motion.div
                        key={`${ad.title}-${idx}`}
                        className="h-full"
                        variants={cardVariants}
                        transition={TRANSITIONS.base}
                    >
                        <VintageAd
                            ad={ad}
                            variant={VARIANTS[idx % VARIANTS.length]}
                        />
                    </motion.div>
                ))}
            </motion.div>
        </section>
    );
};
