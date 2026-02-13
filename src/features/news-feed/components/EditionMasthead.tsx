"use client";

import React from "react";
import { motion } from "framer-motion";
import { fadeUp, TRANSITIONS } from "@/shared/motion/motionTokens";

interface EditionMastheadProps {
    editionHeaderDate: string;
}

export const EditionMasthead: React.FC<EditionMastheadProps> = ({ editionHeaderDate }) => {
    const mastheadVariants = fadeUp(16);

    return (
        <motion.div
            className="p-8 text-center border-b-4 border-[var(--color-text-primary)] mb-8 max-w-5xl mx-auto w-full"
            variants={mastheadVariants}
            initial="hidden"
            animate="show"
            transition={TRANSITIONS.base}
        >
            <h2 className="font-masthead text-6xl uppercase tracking-tighter mb-2">
                The Transcript
            </h2>
            <div className="flex flex-wrap justify-between gap-2 border-t border-b border-[var(--color-text-primary)] py-1 font-mono text-sm uppercase">
                <span>Vol. 120 · No. 8</span>
                <span>{editionHeaderDate}</span>
                <span>Price: 30¢</span>
            </div>
        </motion.div>
    );
};
