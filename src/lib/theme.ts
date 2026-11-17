export type AppTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "adetailing-theme";
export const THEME_CHANGE_EVENT = "adetailing:theme-change";

export function parseTheme(value: unknown): AppTheme {
  return value === "dark" ? "dark" : "light";
}

// Run in the document head, before the first paint. Keep the existing light
// appearance until a user explicitly opts in; blocked storage is harmless.
export const THEME_BOOTSTRAP_SCRIPT = `(function(){var theme="light";try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")theme="dark";}catch(_){}document.documentElement.dataset.theme=theme;})();`;
