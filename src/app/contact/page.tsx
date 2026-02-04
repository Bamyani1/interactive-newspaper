import React from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { Reveal } from "@/shared/motion/Reveal";

export default function ContactPage() {
    return (
        <PageShell variant="default" hasHeader>
            <TimeControls />
            <main className="w-full">
                <div className="max-w-3xl mx-auto px-6 py-10">
                    <Reveal delay={0}>
                        <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)] mb-3">
                            Contact
                        </p>
                    </Reveal>
                    <Reveal delay={0.05}>
                        <h1 className="font-header text-3xl mb-4">
                            Reach the Archive Team
                        </h1>
                    </Reveal>
                    <Reveal delay={0.1}>
                        <p className="text-base text-[var(--color-text-secondary)] leading-relaxed mb-4">
                            For corrections, accessibility requests, or archival inquiries,
                            email us and we will respond as soon as we can.
                        </p>
                    </Reveal>
                    <Reveal delay={0.15}>
                        <a
                            href="mailto:archive@transcript.edu"
                            className="text-base text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
                        >
                            archive@transcript.edu
                        </a>
                    </Reveal>
                </div>
            </main>
        </PageShell>
    );
}
