import { notFound } from "next/navigation";
import {
    Button,
    Card,
    Input,
    Label,
    Prose,
} from "@/shared/ui/primitives";

export const metadata = {
    title: "Primitives demo · Direction A",
    robots: { index: false, follow: false },
};

export default function PrimitivesDemoPage() {
    if (process.env.NODE_ENV === "production") notFound();

    return (
        <main className="min-h-screen bg-[var(--color-bg-paper)] text-[var(--color-text-body)]">
            <div className="mx-auto max-w-[64rem] px-6 py-10 space-y-12">
                <header className="border-t-2 border-b border-[var(--color-rule-ink)] py-4">
                    <Label size="md" tone="accent">Direction A · primitive demo</Label>
                    <h1 className="font-display text-3xl font-bold tracking-tight mt-2 mb-1">
                        Primitive component library
                    </h1>
                    <p className="text-[var(--color-text-muted)] text-sm">
                        Phase-5 sign-off surface. Every variant of every primitive in every interactive state. Tab through with the keyboard to verify focus rings.
                    </p>
                </header>

                <Section heading="Button — variants">
                    <div className="flex flex-wrap items-center gap-3">
                        <Button variant="primary">Primary</Button>
                        <Button variant="secondary">Secondary</Button>
                        <Button variant="accent">Accent</Button>
                        <Button variant="ghost">Ghost</Button>
                        <Button variant="icon" aria-label="Open menu">☰</Button>
                        <Button variant="link" as="a" href="#">Inline link</Button>
                    </div>
                </Section>

                <Section heading="Button — sizes">
                    <div className="flex items-center gap-3">
                        <Button size="sm">Small</Button>
                        <Button size="md">Medium</Button>
                        <Button size="sm" variant="accent">Small accent</Button>
                        <Button size="md" variant="accent">Medium accent</Button>
                    </div>
                </Section>

                <Section heading="Button — states">
                    <div className="flex flex-wrap items-center gap-3">
                        <Button>Default</Button>
                        <Button disabled>Disabled</Button>
                        <Button variant="accent">Hover me</Button>
                        <Button variant="link" as="a" href="#">Link, no padding</Button>
                    </div>
                    <p className="text-[var(--color-text-muted)] text-xs mt-2">Tab through; every variant should show a 2px red focus outline with 2px offset.</p>
                </Section>

                <Section heading="Input">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
                        <div>
                            <label htmlFor="i1" className="font-mono text-xs uppercase tracking-label-md text-[var(--color-text-muted)] mb-2 block">Default (md)</label>
                            <Input id="i1" placeholder="Search the archive…" />
                        </div>
                        <div>
                            <label htmlFor="i2" className="font-mono text-xs uppercase tracking-label-md text-[var(--color-text-muted)] mb-2 block">Compact (sm)</label>
                            <Input id="i2" size="sm" placeholder="Compact" />
                        </div>
                        <div>
                            <label htmlFor="i3" className="font-mono text-xs uppercase tracking-label-md text-[var(--color-text-muted)] mb-2 block">Disabled</label>
                            <Input id="i3" disabled defaultValue="Disabled value" />
                        </div>
                        <div>
                            <label htmlFor="i4" className="font-mono text-xs uppercase tracking-label-md text-[var(--color-text-muted)] mb-2 block">Invalid</label>
                            <Input id="i4" invalid defaultValue="Invalid input" />
                        </div>
                    </div>
                </Section>

                <Section heading="Card">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card>
                            <Label size="sm" tone="accent" className="mb-2 block">Default card</Label>
                            <h3 className="font-display text-lg font-semibold mb-2">Student senate approves widened library hours</h3>
                            <p className="text-sm text-[var(--color-text-muted)]">Hairline border, paper-soft background, 24px padding. Used by ArticleCard, SearchResultCard.</p>
                        </Card>
                        <Card variant="inset">
                            <Label size="sm" tone="accent" className="mb-2 block">Inset card</Label>
                            <p className="text-sm text-[var(--color-text-body)]">Inset background, no border. Used for caveat boxes and quote highlights.</p>
                        </Card>
                    </div>
                </Section>

                <Section heading="Label">
                    <div className="flex flex-wrap gap-6 items-baseline">
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
                            <p>Inline elements: <strong>bold</strong>, <em>italic</em>, <a href="#">a link</a>, and <code>inline code</code>. Numeric data uses old-style numerals: 1960, 683, 11:15 p.m.</p>
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
                            <pre><code>{`const edition = await getEdition("1960-01-13");
for (const article of edition.articles) {
  console.log(article.headline);
}`}</code></pre>
                            <table>
                                <thead><tr><th>Role</th><th>Rate</th><th>Total</th></tr></thead>
                                <tbody>
                                    <tr><td>Librarian</td><td>$3.10</td><td>$124</td></tr>
                                    <tr><td>Student asst.</td><td>$1.05</td><td>$42</td></tr>
                                </tbody>
                            </table>
                        </Prose>
                    </Card>
                    <p className="text-[var(--color-text-muted)] text-xs mt-2">Note: Phase 6 wires the full prose typography spec into <code>src/styles/components/ask-archive/markdown-prose.css</code>. This page applies the legacy <code>.prose</code> styling for now.</p>
                </Section>

                <Section heading="Focus ring (default :focus-visible)">
                    <div className="flex flex-wrap gap-3">
                        <Button>Tab onto me</Button>
                        <a href="#" className="text-[var(--color-accent)] underline">Native anchor</a>
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
