import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeltaTypewriter } from "@/src/features/ask-archive/hooks/useAskArchive";

/**
 * The typewriter drains via requestAnimationFrame/setTimeout ticks; fake
 * timers let the tests step through them deterministically.
 */

function makeTypewriter() {
    const emitted: string[] = [];
    const controller = new AbortController();
    const tw = new DeltaTypewriter((t) => emitted.push(t), controller.signal);
    return { tw, emitted, controller };
}

async function runTicks(count = 200): Promise<void> {
    for (let i = 0; i < count; i += 1) {
        await vi.advanceTimersByTimeAsync(20);
    }
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("DeltaTypewriter", () => {
    it("emits pushed text completely across ticks", async () => {
        const { tw, emitted } = makeTypewriter();
        tw.push("The march drew hundreds downtown that spring. ");
        await runTicks();
        expect(emitted.join("")).toBe(
            "The march drew hundreds downtown that spring. ",
        );
        expect(emitted.length).toBeGreaterThan(1);
    });

    it("never emits a slice that ends mid-word while streaming", async () => {
        const { tw, emitted } = makeTypewriter();
        tw.push("Students protested the decision loudly ");
        await runTicks();
        for (const slice of emitted) {
            expect(slice.endsWith(" ")).toBe(true);
        }
    });

    it("parks on a partial word until more text arrives", async () => {
        const { tw, emitted } = makeTypewriter();
        tw.push("Hello wor");
        await runTicks(20);
        expect(emitted.join("")).toBe("Hello ");
        tw.push("ld again ");
        await runTicks();
        expect(emitted.join("")).toBe("Hello world again ");
    });

    it("settle flushes a trailing partial word", async () => {
        const { tw, emitted } = makeTypewriter();
        tw.push("Final word");
        const settled = tw.settle();
        await runTicks();
        await settled;
        expect(emitted.join("")).toBe("Final word");
    });

    it("does not stall on a long unbroken token", async () => {
        const { tw, emitted } = makeTypewriter();
        const token = "x".repeat(60);
        tw.push(token);
        await runTicks();
        expect(emitted.join("").length).toBeGreaterThan(0);
    });

    it("stops emitting after abort", async () => {
        const { tw, emitted, controller } = makeTypewriter();
        tw.push("some words arrive here ");
        await runTicks(2);
        const before = emitted.join("").length;
        controller.abort();
        await runTicks();
        expect(emitted.join("").length).toBe(before);
        const settled = tw.settle();
        await runTicks(5);
        await settled;
    });
});
