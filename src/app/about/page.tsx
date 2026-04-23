import React from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { SiteFooter } from "@/features/footer";
import { Reveal } from "@/shared/motion/Reveal";

export default function AboutPage() {
    return (
        <PageShell variant="default" hasHeader>
            <TimeControls />
            <main className="w-full flex-1">
                <div className="max-w-3xl mx-auto px-6 py-10">
                    <Reveal delay={0}>
                        <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)] mb-3">
                            About
                        </p>
                    </Reveal>
                    <Reveal delay={0.05}>
                        <h1 className="font-header text-3xl mb-4 text-balance">
                            The Transcript Archive
                        </h1>
                    </Reveal>
                    <Reveal delay={0.1}>
                        <p className="text-base text-[var(--color-text-secondary)] leading-relaxed mb-4">
                            The Transcript Archive preserves decades of student reporting, campus
                            life, and community history. Browse by date, explore sections, and
                            read the original layouts as they appeared in print.
                        </p>
                    </Reveal>
                    <Reveal delay={0.15}>
                        <p className="text-base text-[var(--color-text-secondary)] leading-relaxed">
                            This project celebrates the voices that shaped the paper and makes
                            the archive accessible for students, alumni, and researchers.
                        </p>
                    </Reveal>
                </div>
            </main>
            <SiteFooter />
        </PageShell>
    );
}
