"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { ThemeModeToggle } from "@/features/theme";

interface EditionFooterProps {
    onNextEdition: () => void;
    canGoToNextEdition: boolean;
}

export const EditionFooter: React.FC<EditionFooterProps> = ({
    onNextEdition,
    canGoToNextEdition,
}) => {
    return (
        <>
            <div className="p-8 flex justify-center mt-10 border-t border-[var(--color-text-primary)] max-w-5xl mx-auto w-full">
                <button
                    onClick={onNextEdition}
                    disabled={!canGoToNextEdition}
                    className="group flex items-center gap-3 text-xl font-header hover:underline underline-offset-4"
                >
                    See Next Edition
                    <motion.span
                        animate={{ x: [0, 5, 0] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                    >
                        <ArrowRight />
                    </motion.span>
                </button>
            </div>

            <div className="pb-8">
                <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)]">
                    <Link
                        href="/about"
                        className="hover:text-[var(--color-text-primary)] transition-colors"
                    >
                        About
                    </Link>
                    <span aria-hidden="true">•</span>
                    <Link
                        href="/contact"
                        className="hover:text-[var(--color-text-primary)] transition-colors"
                    >
                        Contact
                    </Link>
                    <span aria-hidden="true">•</span>
                    <ThemeModeToggle />
                </div>
            </div>
        </>
    );
};
