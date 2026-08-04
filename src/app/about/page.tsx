import React from "react";
import { PageShell } from "@/shared";
import { TimeControls } from "@/features/time-controls";
import { SiteFooter } from "@/features/footer";

export default function AboutPage() {
    return (
        <PageShell variant="default" hasHeader>
            <TimeControls />
            <main id="main-content" tabIndex={-1} className="w-full flex-1">
                <div className="max-w-3xl mx-auto px-6 py-10">
                    <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)] mb-3">
                        About
                    </p>
                    <h1 className="font-header text-3xl mb-4 text-balance">
                        The Transcript Archive
                    </h1>
                    <p className="text-base text-[var(--color-text-secondary)] leading-relaxed mb-4">
                        The Transcript Archive preserves decades of student reporting, campus
                        life, and community history. Browse by date, explore sections, and
                        read the original layouts as they appeared in print.
                    </p>
                    <p className="text-base text-[var(--color-text-secondary)] leading-relaxed">
                        This project celebrates the voices that shaped the paper and makes
                        the archive accessible for students, alumni, and researchers.
                    </p>

                    <hr className="my-10 border-0 border-t border-[var(--color-rule-hairline)]" />

                    <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)] mb-3">
                        How it was built
                    </p>
                    <h2 className="font-header text-2xl mb-4 text-balance">
                        From bulk scans to a searchable, AI-augmented archive
                    </h2>
                    <p className="text-base text-[var(--color-text-secondary)] leading-relaxed mb-4">
                        Ohio Wesleyan University&rsquo;s student newspaper, <em>The Transcript</em>,
                        has been published since 1867. Decades of its print editions existed
                        only as bulk scanned TIF files in the OCLC ContentDM archive &mdash;
                        unsearchable, unstructured, and effectively invisible to anyone who
                        didn&rsquo;t already know the exact date they were looking for. The goal
                        of this project was to turn half a century of that print history
                        (1950&ndash;2006) into a tool anyone can query in plain language.
                    </p>
                    <p className="text-base text-[var(--color-text-secondary)] leading-relaxed mb-4">
                        A Python OCR pipeline converts each raw scan into structured articles,
                        advertisements, and cropped images. A TypeScript retrieval system then
                        indexes that content as 768-dimension multimodal embeddings in Postgres
                        with pgvector, and answers questions using hybrid search &mdash;
                        combining vector similarity with full-text relevance &mdash; an agent
                        loop for more complex queries, and answers that are grounded in cited
                        source articles rather than invented.
                    </p>
                    <p className="text-base text-[var(--color-text-secondary)] leading-relaxed mb-4">
                        Today the archive holds 351 fully ingested editions
                        (1950&ndash;2006), 11,705 articles with complete multimodal embedding
                        coverage, and 6,846 advertisements, alongside period-accurate weather
                        (1950&ndash;2000) and US music-chart (1958&ndash;2010) sidebars that
                        place each edition in its moment. Retrieval runs against versioned,
                        immutable index builds so results stay reproducible as the corpus grows.
                    </p>
                    <p className="text-base text-[var(--color-text-secondary)] leading-relaxed">
                        The stack: Next.js 16 and React 19 on the front end; TypeScript
                        throughout; a Python 3.12 OCR pipeline; Neon Postgres with pgvector for
                        storage and retrieval; Cloudflare R2 for image assets; Google Gemini for
                        embeddings and generation; and Vercel for deployment. Deeper write-ups of
                        each subsystem live in the{" "}
                        <a
                            href="https://github.com/Bamyani1/interactive-newspaper/tree/main/docs/architecture"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--color-text-primary)] underline decoration-[var(--color-accent)]/40 underline-offset-4 hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)] transition-colors"
                        >
                            architecture docs
                        </a>
                        .
                    </p>

                    <hr className="my-10 border-0 border-t border-[var(--color-rule-hairline)]" />

                    <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)] mb-3">
                        Who built this
                    </p>
                    <h2 className="font-header text-2xl mb-4 text-balance">
                        Mostafa Anwari
                    </h2>
                    <p className="text-base text-[var(--color-text-secondary)] leading-relaxed mb-4">
                        I designed and built The Transcript Archive end to end &mdash; the OCR
                        and data pipelines, the retrieval system, and the reading experience
                        &mdash; to make a piece of Ohio Wesleyan&rsquo;s history genuinely
                        usable again. I&rsquo;m happy to talk through any part of how it works.
                    </p>
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                        <a
                            href="mailto:anwari.works@gmail.com"
                            className="inline-flex items-center min-h-[44px] text-base text-[var(--color-text-primary)] underline decoration-[var(--color-accent)]/40 underline-offset-4 hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)] transition-colors"
                        >
                            anwari.works@gmail.com
                        </a>
                        <a
                            href="https://github.com/Bamyani1/interactive-newspaper"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center min-h-[44px] text-base text-[var(--color-text-primary)] underline decoration-[var(--color-accent)]/40 underline-offset-4 hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)] transition-colors"
                        >
                            Source on GitHub
                        </a>
                    </div>
                </div>
            </main>
            <SiteFooter />
        </PageShell>
    );
}
