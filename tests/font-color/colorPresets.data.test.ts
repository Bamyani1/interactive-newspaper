import { describe, expect, it } from "vitest";
import { PRESETS } from "../../font-color/data/colorPresets";

describe("color preset data integrity", () => {
    it("has the expected total and mode/category distribution", () => {
        expect(PRESETS).toHaveLength(48);
        expect(PRESETS.filter((preset) => preset.mode === "dark")).toHaveLength(24);
        expect(PRESETS.filter((preset) => preset.mode === "light")).toHaveLength(24);

        expect(
            PRESETS.filter((preset) => preset.category === "Dark Voltage")
        ).toHaveLength(20);
        expect(
            PRESETS.filter((preset) => preset.category === "Bright Chroma")
        ).toHaveLength(20);
    });

    it("has unique preset ids", () => {
        const ids = PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
