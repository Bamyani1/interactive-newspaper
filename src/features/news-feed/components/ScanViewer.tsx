"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { X, ZoomIn, ZoomOut } from "lucide-react";

interface ScanViewerProps {
    isOpen: boolean;
    pages: string[];
    activeIndex: number;
    onClose: () => void;
    onSelectPage: (index: number) => void;
}

export const ScanViewer: React.FC<ScanViewerProps> = ({
    isOpen,
    pages,
    activeIndex,
    onClose,
    onSelectPage,
}) => {
    const [zoom, setZoom] = useState(1);

    // Reset zoom when opening
    useEffect(() => {
        if (isOpen) setZoom(1);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return () => {};
        }

        const handler = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [isOpen, onClose]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[60] bg-[color-mix(in_srgb,var(--color-bg-primary)_88%,transparent)] backdrop-blur-sm flex flex-col"
                >
                    <div className="flex items-center justify-between px-6 py-4 text-[var(--color-text-primary)] border-b border-[color-mix(in_srgb,var(--color-text-primary)_10%,transparent)]">
                        <div>
                            <p className="font-header text-lg">Scanned Page {activeIndex + 1}</p>
                            <p className="text-xs opacity-70">
                                Original newspaper scan · use thumbnails to switch pages
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                className="px-3 py-2 bg-[color-mix(in_srgb,var(--color-text-primary)_10%,transparent)] rounded hover:bg-[color-mix(in_srgb,var(--color-text-primary)_20%,transparent)] transition"
                                onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
                                aria-label="Zoom out"
                            >
                                <ZoomOut size={16} />
                            </button>
                            <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
                            <button
                                className="px-3 py-2 bg-[color-mix(in_srgb,var(--color-text-primary)_10%,transparent)] rounded hover:bg-[color-mix(in_srgb,var(--color-text-primary)_20%,transparent)] transition"
                                onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                                aria-label="Zoom in"
                            >
                                <ZoomIn size={16} />
                            </button>
                            <button
                                className="ml-4 px-3 py-2 bg-[color-mix(in_srgb,var(--color-text-primary)_10%,transparent)] rounded hover:bg-[color-mix(in_srgb,var(--color-text-primary)_20%,transparent)] transition flex items-center gap-2"
                                onClick={onClose}
                            >
                                <X size={16} />
                                Close
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto flex items-center justify-center p-4">
                        <motion.div
                            key={activeIndex}
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.2 }}
                            style={{ scale: zoom }}
                            className="shadow-2xl border border-[color-mix(in_srgb,var(--color-text-primary)_10%,transparent)] bg-[color-mix(in_srgb,var(--color-bg-primary)_75%,transparent)] p-2"
                        >
                            <Image
                                src={pages[activeIndex]}
                                alt={`Scanned newspaper page ${activeIndex + 1}`}
                                width={1100}
                                height={1400}
                                className="h-auto w-full object-contain"
                                priority
                            />
                        </motion.div>
                    </div>

                    <div className="p-3 bg-[color-mix(in_srgb,var(--color-bg-primary)_92%,transparent)] border-t border-[color-mix(in_srgb,var(--color-text-primary)_10%,transparent)] overflow-x-auto">
                        <div className="flex items-center gap-3 min-w-max">
                            {pages.map((pageSrc, index) => {
                                const isActive = index === activeIndex;
                                return (
                                    <button
                                        key={pageSrc}
                                        onClick={() => onSelectPage(index)}
                                        className={`
                                            relative rounded overflow-hidden border transition
                                            ${isActive ? "border-[var(--color-text-primary)]" : "border-[color-mix(in_srgb,var(--color-text-primary)_25%,transparent)] hover:border-[color-mix(in_srgb,var(--color-text-primary)_50%,transparent)]"}
                                        `}
                                        aria-label={`Open scanned page ${index + 1}`}
                                    >
                                        <Image
                                            src={pageSrc}
                                            alt={`Thumbnail for page ${index + 1}`}
                                            width={120}
                                            height={160}
                                            className="object-cover"
                                        />
                                        <span className={`
                                            absolute top-1 left-1 text-[10px] font-mono px-2 py-1 rounded
                                            ${isActive ? "bg-[var(--color-text-primary)] text-[var(--color-text-inverse)]" : "bg-[color-mix(in_srgb,var(--color-bg-primary)_80%,transparent)] text-[var(--color-text-primary)]"}
                                        `}>
                                            Pg {index + 1}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
