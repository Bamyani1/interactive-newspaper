"use client";

import React from "react";
import { ArrowRight } from "lucide-react";
import { SiteFooter } from "@/features/footer";

interface EditionFooterProps {
    onNextEdition: () => void;
    canGoToNextEdition: boolean;
    isPending?: boolean;
}

export const EditionFooter: React.FC<EditionFooterProps> = ({
    onNextEdition,
    canGoToNextEdition,
    isPending = false,
}) => {
    return (
        <SiteFooter
            primaryAction={
                <button
                    type="button"
                    onClick={onNextEdition}
                    disabled={!canGoToNextEdition || isPending}
                    className="group flex items-center justify-center gap-2 overflow-visible"
                    aria-busy={isPending}
                >
                    {isPending ? "Opening Edition…" : "See Next Edition"}
                    <span className="inline-flex shrink-0 items-center transition-transform group-hover:translate-x-0.5 group-disabled:translate-x-0" aria-hidden>
                        <ArrowRight size={18} className="text-current" strokeWidth={2.25} />
                    </span>
                </button>
            }
        />
    );
};
