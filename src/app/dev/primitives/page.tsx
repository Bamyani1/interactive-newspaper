import { notFound } from "next/navigation";
import {
    Button,
    Card,
    Input,
    Label,
    Prose,
    ProseCodeBlock,
} from "@/shared/ui/primitives";

export const metadata = {
    title: "Primitives demo · Direction A",
    robots: { index: false, follow: false },
};

const INLINE_LINK_JUSTIFICATION =
    "design.md defines the link variant as inline text, not a button.";
const PROSE_LINK_JUSTIFICATION =
    "design.md defines Prose anchors as hyperlinks embedded in body copy.";

export default function PrimitivesDemoPage() {
    if (process.env.NODE_ENV === "production") notFound();

    return (
        <main id="main-content" tabIndex={-1} className="min-h-screen bg-[var(--color-bg-paper)] text-[var(--color-text-body)]">
            <div className="mx-auto max-w-[64rem] space-y-7 px-5 py-7">
                <header className="border-t-2 border-b border-[var(--color-rule-ink)] py-4">
                    <Label size="md" tone="accent">Direction A · primitive demo</Label>
                    <h1 className="font-display text-3xl font-bold tracking-tight mt-2 mb-1">
                        Primitive component library
                    </h1>
                    <p className="text-[var(--color-text-muted)] text-sm">
                        Canonical sign-off surface for light and dark semantics. Tab through with the keyboard to verify focus rings and control states.
                    </p>
                </header>

                <Section heading="Button — variants">
                    <div className="flex flex-wrap items-center gap-3">
                        <Button variant="primary">Primary</Button>
                        <Button variant="secondary">Secondary</Button>
                        <Button variant="accent">Accent</Button>
                        <Button variant="ghost">Ghost</Button>
                        <Button variant="icon" aria-label="Open menu">☰</Button>
                        <Button variant="link" as="a" href="#" data-audit-inline-text-link={INLINE_LINK_JUSTIFICATION}>Inline link</Button>
                    </div>
                </Section>

                <Section heading="Button — size contract">
                    <div data-testid="button-size-row" className="flex max-w-full flex-wrap items-center gap-3">
                        <Button>Standard action</Button>
                        <Button>Longer standard action</Button>
                        <Button variant="accent">Accent action</Button>
                        <Button variant="icon" aria-label="Open controls">☰</Button>
                    </div>
                </Section>

                <Section heading="Button — states">
                    <div className="flex flex-wrap items-center gap-3">
                        <Button>Default</Button>
                        <Button disabled>Disabled</Button>
                        <Button variant="accent">Hover me</Button>
                        <Button disabled aria-busy="true">Loading…</Button>
                        <Button variant="link" as="a" href="#" data-audit-inline-text-link={INLINE_LINK_JUSTIFICATION}>Link, no padding</Button>
                    </div>
                    <p className="text-[var(--color-text-muted)] text-xs mt-2">Every control uses at least 12px text; button targets are 44px tall. Tab focus uses a 2px semantic outline with 2px offset.</p>
                </Section>

                <Section heading="Input">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
                        <div>
                            <label htmlFor="i1" className="font-mono text-xs uppercase tracking-label-md text-[var(--color-text-muted)] mb-2 block">Default · 16px type, 12×16px padding</label>
                            <Input id="i1" placeholder="Search the archive…" />
                        </div>
                        <div>
                            <label htmlFor="i2" className="font-mono text-xs uppercase tracking-label-md text-[var(--color-text-muted)] mb-2 block">Read only</label>
                            <Input id="i2" readOnly defaultValue="Canonical input geometry" />
                        </div>
                        <div>
                            <label htmlFor="i3" className="font-mono text-xs uppercase tracking-label-md text-[var(--color-text-muted)] mb-2 block">Disabled</label>
                            <Input id="i3" disabled defaultValue="Disabled value" />
                        </div>
                        <div>
                            <label htmlFor="i4" className="font-mono text-xs uppercase tracking-label-md text-[var(--color-text-muted)] mb-2 block">Invalid</label>
                            <Input id="i4" invalid aria-describedby="i4-error" defaultValue="Invalid input" />
                            <p id="i4-error" className="mt-2 text-xs text-[var(--color-warning)]">Explain the error in text; color is supplementary.</p>
                        </div>
                    </div>
                </Section>

                <Section heading="Card">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card>
                            <Label size="sm" tone="accent" className="mb-2 block">Default card</Label>
                            <h3 className="font-display text-lg font-semibold mb-2">Student senate approves widened library hours</h3>
                            <p className="text-sm text-[var(--color-text-muted)]">Hairline border, paper-soft background, 24px padding. Use for bounded interactive or document surfaces.</p>
                        </Card>
                        <Card variant="inset">
                            <Label size="sm" tone="accent" className="mb-2 block">Inset card</Label>
                            <p className="text-sm text-[var(--color-text-body)]">Inset background, no border. Used for caveat boxes and quote highlights.</p>
                        </Card>
                    </div>
                </Section>

                <Section heading="Deterministic audit fixtures">
                    <p className="mb-4 max-w-2xl text-sm text-[var(--color-text-muted)]">
                        Stable specimens for states that are transient or otherwise unsafe to trigger during a visual audit. They use generic copy and never expose runtime error details.
                    </p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <Card
                            as="article"
                            data-audit-fixture="loading"
                            aria-labelledby="audit-loading-title"
                            aria-busy="true"
                        >
                            <Label size="sm" tone="accent" className="mb-2 block">Loading state</Label>
                            <h3 id="audit-loading-title" className="font-display text-lg font-semibold">Loading archive results</h3>
                            <p role="status" className="mt-2 text-sm text-[var(--color-text-muted)]">Please wait while the archive is prepared.</p>
                        </Card>
                        <Card
                            as="article"
                            data-audit-fixture="empty"
                            aria-labelledby="audit-empty-title"
                        >
                            <Label size="sm" tone="accent" className="mb-2 block">Empty state</Label>
                            <h3 id="audit-empty-title" className="font-display text-lg font-semibold">No matching editions</h3>
                            <p className="mt-2 text-sm text-[var(--color-text-muted)]">Try a different date or search term.</p>
                        </Card>
                        <Card
                            as="article"
                            data-audit-fixture="error"
                            aria-labelledby="audit-error-title"
                        >
                            <Label size="sm" tone="accent" className="mb-2 block">Error state</Label>
                            <h3 id="audit-error-title" className="font-display text-lg font-semibold">Something went wrong</h3>
                            <p className="mt-2 text-sm text-[var(--color-text-muted)]">We couldn’t display this content. Please try again.</p>
                            <Button className="mt-4">Try again</Button>
                        </Card>
                    </div>
                </Section>

                <Section heading="Label">
                    <div className="flex flex-wrap gap-5 items-baseline">
                        <Label size="xs">Label xs muted</Label>
                        <Label size="sm">Label sm muted</Label>
                        <Label size="md">Label md muted</Label>
                        <Label size="md" tone="accent">Label md accent</Label>
                        <Label size="md" tone="body">Label md body</Label>
                    </div>
                </Section>

                <Section heading="Prose (Markdown sample)">
                    <Card variant="inset">
                        <Prose>
                            <p>Inline elements: <strong>bold</strong>, <em>italic</em>, <a href="#" data-audit-inline-text-link={PROSE_LINK_JUSTIFICATION}>a link</a>, and <code>inline code</code>. Numeric data uses old-style numerals: 1960, 683, 11:15 p.m.</p>
                            <h2>Section heading (h2)</h2>
                            <p>Body paragraph with adequate line-height and old-style numerals turned on. Note kerning + ligatures on &ldquo;ff&rdquo; and &ldquo;fi&rdquo;.</p>
                            <blockquote>A blockquote with citation. <em>— Ann Whitlow, Senate President, Jan. 13, 1960</em></blockquote>
                            <h3>Sub-heading (h3)</h3>
                            <ul>
                                <li>Unordered list item</li>
                                <li>Another item
                                    <ul>
                                        <li>Nested</li>
                                    </ul>
                                </li>
                            </ul>
                            <ol>
                                <li>Ordered list item</li>
                                <li>Another</li>
                            </ol>
                            <ProseCodeBlock><code>{`const edition = await getEdition("1960-01-13");
for (const article of edition.articles) {
  console.log(article.headline);
}`}</code></ProseCodeBlock>
                            <table>
                                <thead><tr><th>Role</th><th>Rate</th><th>Total</th></tr></thead>
                                <tbody>
                                    <tr><td>Librarian</td><td>$3.10</td><td>$124</td></tr>
                                    <tr><td>Student asst.</td><td>$1.05</td><td>$42</td></tr>
                                </tbody>
                            </table>
                        </Prose>
                    </Card>
                    <p className="text-[var(--color-text-muted)] text-xs mt-2">The shared <code>.prose</code> contract uses the canonical body size, 1.55 leading, and 16px paragraph rhythm.</p>
                </Section>

                <section
                    data-mode="dark"
                    className="rounded-none border border-[var(--color-rule-hairline)] bg-[var(--color-bg-paper)] p-5 text-[var(--color-text-body)]"
                >
                    <Label size="md" tone="accent">Dark-mode semantic contrast</Label>
                    <h2 className="mt-2 mb-4 border-b border-[var(--color-rule-hairline)] pb-2 font-display text-xl font-semibold">
                        Ink-surface states
                    </h2>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button>Primary</Button>
                        <Button variant="accent">Accent</Button>
                        <Button variant="secondary">Secondary</Button>
                        <Button variant="link" as="a" href="#" data-audit-inline-text-link={INLINE_LINK_JUSTIFICATION}>Accessible accent link</Button>
                    </div>
                    <div className="mt-4 max-w-xl">
                        <label htmlFor="dark-input" className="mb-2 block font-mono text-xs uppercase tracking-label-md text-[var(--color-text-muted)]">Dark input</label>
                        <Input id="dark-input" placeholder="Focus to inspect the light red ring" />
                    </div>
                    <p className="mt-4 text-xs text-[var(--color-text-muted)]">Accent text and focus indicators use the documented red-200 token on all ink surfaces; filled accents retain the brand red.</p>
                </section>

                <Section heading="Focus ring (default :focus-visible)">
                    <div className="flex flex-wrap gap-3">
                        <Button>Tab onto me</Button>
                        <a href="#" className="text-[var(--color-accent-text)] underline">Native anchor</a>
                        <input type="text" placeholder="Native input" className="border border-[var(--color-text-body)] px-3 py-2 rounded-sm" />
                    </div>
                    <p className="text-[var(--color-text-muted)] text-xs mt-2">Even native elements without a primitive get the 2px red outline via the global <code>:focus-visible</code> rule in <code>reset.css</code>.</p>
                </Section>

                <footer className="border-t border-[var(--color-rule-hairline)] pt-4 mt-12">
                    <Label size="sm" className="block text-center">
                        End of demo · close this tab and inspect /design.md
                    </Label>
                </footer>
            </div>
        </main>
    );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
    return (
        <section>
            <h2 className="font-display text-xl font-semibold border-b border-[var(--color-rule-hairline)] pb-2 mb-4">
                {heading}
            </h2>
            {children}
        </section>
    );
}
