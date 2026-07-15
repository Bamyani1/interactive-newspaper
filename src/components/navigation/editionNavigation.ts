const EXPLICIT_EDITION_NAVIGATION_KEY = "transcript-explicit-edition-navigation";
let inMemoryExplicitEditionTarget: string | null = null;

/** Mark a client-initiated edition push so its destination starts at the top. */
export function markExplicitEditionNavigation(date: string): void {
    if (typeof window === "undefined") return;
    inMemoryExplicitEditionTarget = date;
    try {
        window.sessionStorage.setItem(EXPLICIT_EDITION_NAVIGATION_KEY, date);
    } catch {
        // Navigation still works when storage is unavailable; only restoration
        // falls back to the last path-keyed position.
    }
}

/** Consume the one-shot intent for the edition that has just committed. */
export function consumeExplicitEditionNavigation(date: string): boolean {
    if (typeof window === "undefined") return false;
    let target = inMemoryExplicitEditionTarget;
    inMemoryExplicitEditionTarget = null;
    try {
        target = window.sessionStorage.getItem(EXPLICIT_EDITION_NAVIGATION_KEY) ?? target;
        window.sessionStorage.removeItem(EXPLICIT_EDITION_NAVIGATION_KEY);
    } catch {
        // Fall through to the in-memory intent when storage is unavailable.
    }
    return target === date;
}
