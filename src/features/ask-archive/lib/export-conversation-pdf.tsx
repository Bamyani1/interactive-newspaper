"use client";

import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Turn } from "../components/Turn";
import type { Turn as TurnData } from "../hooks/askReducer";

const PAGE_FORMAT = "letter";
const PAGE_MARGIN_PT = 36;
const EXPORT_WIDTH_PX = 816;
const EXPORT_PADDING_PX = 48;
const EXPORT_INK = "#111";
const EXPORT_SECONDARY = "#555";
const EXPORT_ACCENT = "#8a1f2d";
const EXPORT_RULE = "#d0d0d0";
const EXPORT_WASH = "#fff7f8";
const EXPORT_PAPER = "#fff";

function waitForPaint(): Promise<void> {
    return new Promise((resolve) => {
        const raf =
            typeof window.requestAnimationFrame === "function"
                ? window.requestAnimationFrame.bind(window)
                : (cb: FrameRequestCallback) =>
                      window.setTimeout(() => cb(performance.now()), 0);

        raf(() => {
            raf(() => resolve());
        });
    });
}

function timeout(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

async function waitForImages(root: HTMLElement): Promise<void> {
    const images = Array.from(root.querySelectorAll("img"));

    await Promise.all(
        images.map(async (img) => {
            if (img.complete) return;

            await Promise.race([
                new Promise<void>((resolve) => {
                    img.addEventListener("load", () => resolve(), {
                        once: true,
                    });
                    img.addEventListener("error", () => resolve(), {
                        once: true,
                    });
                }),
                timeout(2500),
            ]);
        }),
    );
}

function safeFilename(question: string | undefined): string {
    const slug = (question ?? "conversation")
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, " ")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .toLowerCase()
        .slice(0, 56)
        .replace(/-+$/g, "");

    return `ask-the-archive-${slug || "conversation"}.pdf`;
}

function renderExportDocument(root: Root, turns: TurnData[]): void {
    flushSync(() => {
        root.render(<ExportDocument turns={turns} />);
    });
}

function ExportDocument({ turns }: { turns: TurnData[] }) {
    return (
        <div className="ask-export-document">
            <header className="ask-export-header">
                <p className="ask-export-kicker">Ask the Archive</p>
                <h1 className="ask-export-title">Conversation export</h1>
            </header>
            <div className="ask-transcript ask-transcript--export">
                {turns.map((turn, i) => (
                    <Turn
                        key={turn.id}
                        turn={turn}
                        isLatest={i === turns.length - 1}
                        onFollowUp={() => {}}
                        onRetry={() => {}}
                        exportMode
                    />
                ))}
            </div>
        </div>
    );
}

function appendExportHost(): HTMLElement {
    const host = document.createElement("div");
    host.className = "ask-export-root";
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
        position: "absolute",
        left: "-10000px",
        top: "0",
        width: `${EXPORT_WIDTH_PX}px`,
        padding: `${EXPORT_PADDING_PX}px`,
        boxSizing: "border-box",
        background: "#fff",
        color: "#111",
        pointerEvents: "none",
        zIndex: "-1",
    });
    document.body.appendChild(host);
    return host;
}

function applyStyle(
    root: HTMLElement,
    selector: string,
    styles: Partial<CSSStyleDeclaration>,
): void {
    root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        Object.assign(element.style, styles);
    });
}

function sanitizeCanvasStyles(root: HTMLElement): void {
    const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];

    elements.forEach((element) => {
        Object.assign(element.style, {
            backgroundColor: "transparent",
            borderColor: EXPORT_RULE,
            boxShadow: "none",
            color: EXPORT_INK,
            outlineColor: EXPORT_ACCENT,
            textShadow: "none",
        });
    });

    root.style.backgroundColor = EXPORT_PAPER;

    applyStyle(
        root,
        [
            ".ask-export-kicker",
            ".ask-turn-user-label",
            ".ask-source-card-category",
            ".ask-citation-link",
            ".ask-answer-image-attr",
        ].join(","),
        { color: EXPORT_ACCENT },
    );
    applyStyle(
        root,
        [
            ".ask-turn-assistant-label",
            ".ask-source-card-date",
            ".ask-source-card-byline",
            ".ask-source-card-snippet",
            ".ask-source-card-num",
            ".ask-photos-panel-label",
            ".ask-photos-panel-overflow",
            ".ask-photos-tile-caption",
            ".ask-photos-tile-attr",
        ].join(","),
        { color: EXPORT_SECONDARY },
    );
    applyStyle(root, ".ask-caveat, .ask-error-inline", {
        backgroundColor: EXPORT_WASH,
        borderColor: EXPORT_ACCENT,
    });
    applyStyle(root, ".ask-caveat-header, .ask-error-inline-label", {
        color: EXPORT_ACCENT,
    });
    applyStyle(root, ".ask-source-thumb-count", {
        backgroundColor: EXPORT_ACCENT,
        color: EXPORT_PAPER,
    });
    applyStyle(root, ".ask-source-thumb-wrapper, .ask-photos-tile-frame", {
        borderColor: EXPORT_INK,
    });
}

function saveCanvasAsPdf(
    canvas: HTMLCanvasElement,
    PdfCtor: typeof import("jspdf").jsPDF,
    filename: string,
): void {
    const pdf = new PdfCtor({
        orientation: "portrait",
        unit: "pt",
        format: PAGE_FORMAT,
    });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const printableWidth = pageWidth - PAGE_MARGIN_PT * 2;
    const printableHeight = pageHeight - PAGE_MARGIN_PT * 2;
    const imageHeight = (canvas.height * printableWidth) / canvas.width;
    const image = canvas.toDataURL("image/jpeg", 0.95);

    let y = PAGE_MARGIN_PT;
    let remainingHeight = imageHeight;

    pdf.addImage(
        image,
        "JPEG",
        PAGE_MARGIN_PT,
        y,
        printableWidth,
        imageHeight,
    );
    remainingHeight -= printableHeight;

    while (remainingHeight > 0) {
        pdf.addPage();
        y -= printableHeight;
        pdf.addImage(
            image,
            "JPEG",
            PAGE_MARGIN_PT,
            y,
            printableWidth,
            imageHeight,
        );
        remainingHeight -= printableHeight;
    }

    pdf.save(filename);
}

export async function exportConversationPdf(turns: TurnData[]): Promise<void> {
    if (turns.length === 0 || typeof document === "undefined") return;

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
    ]);

    const host = appendExportHost();
    const root = createRoot(host);

    try {
        renderExportDocument(root, turns);
        await waitForPaint();

        const documentNode =
            host.querySelector<HTMLElement>(".ask-export-document");
        if (!documentNode) {
            throw new Error("Export document did not render.");
        }

        await waitForImages(documentNode);
        sanitizeCanvasStyles(documentNode);

        const canvas = await html2canvas(documentNode, {
            allowTaint: false,
            backgroundColor: "#fff",
            height: documentNode.scrollHeight,
            logging: false,
            onclone: (clonedDocument) => {
                sanitizeCanvasStyles(clonedDocument.body);
                const clonedExport =
                    clonedDocument.querySelector<HTMLElement>(
                        ".ask-export-document",
                    );
                if (clonedExport) {
                    clonedExport.style.backgroundColor = EXPORT_PAPER;
                }
            },
            scale: Math.min(window.devicePixelRatio || 1, 2),
            scrollX: 0,
            scrollY: 0,
            useCORS: true,
            width: documentNode.scrollWidth,
            windowHeight: documentNode.scrollHeight,
            windowWidth: documentNode.scrollWidth,
        });

        saveCanvasAsPdf(canvas, jsPDF, safeFilename(turns[0]?.question));
    } finally {
        root.unmount();
        host.remove();
    }
}
