/**
 * Mock data placeholder.
 *
 * Types are now centralized in @/src/types.
 * Re-exports are kept for backward compatibility.
 */

export type { Article } from "@/src/types";

export const getClosestContext = (date: string) => {
    return {
        weather: "Cloudy, 55°F",
        history: [] as string[],
    };
};
