import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Turn } from "@/features/ask-archive/hooks/askReducer";

const { html2canvasMock, pdfMocks } = vi.hoisted(() => ({
    html2canvasMock: vi.fn(),
    pdfMocks: {
        addImage: vi.fn(),
        addPage: vi.fn(),
        save: vi.fn(),
        jsPDF: vi.fn(),
    },
}));

vi.mock("html2canvas", () => ({
    default: html2canvasMock,
}));

vi.mock("jspdf", () => ({
    jsPDF: pdfMocks.jsPDF,
}));

import { exportConversationPdf } from "@/features/ask-archive/lib/export-conversation-pdf";

function makeTurn(overrides: Partial<Turn> = {}): Turn {
    return {
        id: "t-1",
        question: "What happened at OWU?",
        answer: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph [Source 1].",
        status: "done",
        sourceArticles: [
            {
                id: "1960-01-07-0",
                headline: "Source Story",
                editionDate: "1960-01-07",
                category: "News",
                summary: "Summary",
                byline: "Reporter",
                bodySnippet: "A source snippet that must be in the PDF.",
                distance: 0.25,
                imageUrls: [],
                imageCaptions: [],
            },
        ],
        citations: [],
        meta: null,
        confidence: "high",
        requestId: "req-1",
        mode: "text",
        createdAt: 0,
        ...overrides,
    };
}

function makeCanvas(width = 800, height = 1600): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "width", { value: width });
    Object.defineProperty(canvas, "height", { value: height });
    canvas.toDataURL = vi.fn(() => "data:image/jpeg;base64,test");
    return canvas;
}

describe("exportConversationPdf", () => {
    let capturedText = "";
    let capturedHtml = "";

    beforeEach(() => {
        capturedText = "";
        capturedHtml = "";
        html2canvasMock.mockReset();
        pdfMocks.addImage.mockReset();
        pdfMocks.addPage.mockReset();
        pdfMocks.save.mockReset();
        pdfMocks.jsPDF.mockReset();
        pdfMocks.jsPDF.mockImplementation(() => ({
            internal: {
                pageSize: {
                    getWidth: () => 612,
                    getHeight: () => 792,
                },
            },
            addImage: pdfMocks.addImage,
            addPage: pdfMocks.addPage,
            save: pdfMocks.save,
        }));
        html2canvasMock.mockImplementation(async (node: HTMLElement) => {
            capturedText = node.textContent ?? "";
            capturedHtml = node.innerHTML;
            return makeCanvas();
        });
    });

    afterEach(() => {
        document.querySelectorAll(".ask-export-root").forEach((node) => {
            node.remove();
        });
    });

    it("renders the full transcript with expanded sources before saving a PDF", async () => {
        await exportConversationPdf([
            makeTurn({
                id: "t-previous",
                question: "Earlier question?",
            }),
            makeTurn({
                id: "t-current",
                question: "Current question?",
            }),
        ]);

        expect(html2canvasMock).toHaveBeenCalledTimes(1);
        expect(capturedText).toContain("Earlier question?");
        expect(capturedText).toContain("Third paragraph");
        expect(capturedText).toContain("Source Story");
        expect(capturedText).toContain(
            "A source snippet that must be in the PDF.",
        );
        expect(capturedHtml).toContain("ask-source-list-content");
        expect(capturedHtml).not.toContain("ask-turn--previous");
        expect(pdfMocks.save).toHaveBeenCalledWith(
            "ask-the-archive-earlier-question.pdf",
        );
        expect(document.querySelector(".ask-export-root")).toBeNull();
    });

    it("splits tall captures across multiple PDF pages", async () => {
        html2canvasMock.mockResolvedValueOnce(makeCanvas(800, 2400));

        await exportConversationPdf([makeTurn()]);

        expect(pdfMocks.addImage).toHaveBeenCalledTimes(3);
        expect(pdfMocks.addPage).toHaveBeenCalledTimes(2);
    });

    it("cleans up the temporary export DOM if capture fails", async () => {
        html2canvasMock.mockRejectedValueOnce(new Error("capture failed"));

        await expect(exportConversationPdf([makeTurn()])).rejects.toThrow(
            "capture failed",
        );

        expect(document.querySelector(".ask-export-root")).toBeNull();
    });
});
