export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "transcript-mode";
export const DEFAULT_THEME_MODE: ThemeMode = "light";

/**
 * Runs in the document head before styles are painted. Keep this script
 * dependency-free: it must choose the stored mode before React hydrates
 * without introducing a second client-side theme writer.
 */
export const THEME_INITIALIZER_SCRIPT = `(() => {
  const root = document.documentElement;
  let mode = "${DEFAULT_THEME_MODE}";
  try {
    mode = window.localStorage.getItem("${THEME_STORAGE_KEY}") === "dark" ? "dark" : "light";
  } catch {}
  root.dataset.mode = mode;
})();`;
