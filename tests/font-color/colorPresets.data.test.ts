import { describe, expect, it } from "vitest";
import {
    DEFAULT_DARK_TOKENS,
    DEFAULT_LIGHT_TOKENS,
    PRESETS,
    PRESET_STORAGE_KEY,
} from "../../font-color/data/colorPresets";

describe("color preset data integrity", () => {
    it("has the expected total and mode/category distribution", () => {
        expect(PRESETS).toHaveLength(20);
        expect(PRESETS.filter((preset) => preset.mode === "dark")).toHaveLength(10);
        expect(PRESETS.filter((preset) => preset.mode === "light")).toHaveLength(10);

        expect(
            PRESETS.filter((preset) => preset.category === "Broadsheet Dark")
        ).toHaveLength(10);
        expect(
            PRESETS.filter((preset) => preset.category === "Broadsheet Light")
        ).toHaveLength(10);
    });

    it("has unique preset ids", () => {
        const ids = PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("exports DEFAULT_LIGHT_TOKENS with all four brand tokens", () => {
        expect(DEFAULT_LIGHT_TOKENS).toHaveProperty("--owu-red");
        expect(DEFAULT_LIGHT_TOKENS).toHaveProperty("--owu-black");
        expect(DEFAULT_LIGHT_TOKENS).toHaveProperty("--owu-charcoal");
        expect(DEFAULT_LIGHT_TOKENS).toHaveProperty("--owu-white");
    });

    it("exports DEFAULT_DARK_TOKENS with all four brand tokens", () => {
        expect(DEFAULT_DARK_TOKENS).toHaveProperty("--owu-red");
        expect(DEFAULT_DARK_TOKENS).toHaveProperty("--owu-black");
        expect(DEFAULT_DARK_TOKENS).toHaveProperty("--owu-charcoal");
        expect(DEFAULT_DARK_TOKENS).toHaveProperty("--owu-white");
    });

    it("DEFAULT_DARK_TOKENS matches steel-deadline preset", () => {
        const steelDeadline = PRESETS.find((p) => p.id === "steel-deadline");
        expect(steelDeadline).toBeDefined();
        expect(DEFAULT_DARK_TOKENS).toEqual(steelDeadline!.colors);
    });

    it("DEFAULT_LIGHT_TOKENS matches campus-poster preset", () => {
        const campusPoster = PRESETS.find((p) => p.id === "campus-poster");
        expect(campusPoster).toBeDefined();
        expect(DEFAULT_LIGHT_TOKENS).toEqual(campusPoster!.colors);
    });

    it("exports PRESET_STORAGE_KEY as a string", () => {
        expect(typeof PRESET_STORAGE_KEY).toBe("string");
        expect(PRESET_STORAGE_KEY).toBe("tts-color-preset");
    });
});
