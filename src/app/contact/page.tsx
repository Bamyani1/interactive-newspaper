import React from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { SiteFooter } from "@/features/footer";

export default function ContactPage() {
    return (
        <PageShell variant="default" hasHeader>
            <TimeControls />
            <main id="main-content" tabIndex={-1} className="w-full flex-1">
                <div className="max-w-3xl mx-auto px-6 py-10">
                    <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)] mb-3">
                        Corrections &amp; inquiries
                    </p>
                    <h1 className="font-header text-2xl sm:text-3xl leading-tight mb-4 text-balance">
                        Found something we should revisit?
                    </h1>
                    <p className="text-base text-[var(--color-text-secondary)] leading-relaxed mb-4">
                        Send us a note about an OCR error, missing context, accessibility
                        need, or archival question. Please include the edition date or
                        article headline when you can.
                    </p>
                    <a
                        href="mailto:anwari.works@gmail.com"
                        className="inline-flex items-center min-h-[44px] text-base text-[var(--color-text-primary)] underline decoration-[var(--color-accent)]/40 underline-offset-4 hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)] transition-colors"
                    >
                        anwari.works@gmail.com
                    </a>
                </div>
            </main>
            <SiteFooter />
        </PageShell>
    );
}
