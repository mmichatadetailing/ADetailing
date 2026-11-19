"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Toaster } from "sonner";
import { parseTheme, THEME_CHANGE_EVENT, THEME_STORAGE_KEY, type AppTheme } from "@/lib/theme";

function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0e1116" : "#f5f5f2");
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    applyTheme(parseTheme(event.newValue));
    onChange();
  };
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): AppTheme { return parseTheme(document.documentElement.dataset.theme); }
function getServerSnapshot(): AppTheme { return "light"; }

export function setAppTheme(theme: AppTheme) {
  applyTheme(theme);
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Still usable in this tab if storage is blocked. */ }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function useAppTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useAppTheme();
  // During hydration the server snapshot is light; never overwrite the theme
  // already applied by the head script with that temporary snapshot.
  useEffect(() => { applyTheme(getSnapshot()); }, [theme]);
  return <>{children}<Toaster theme={theme} richColors closeButton position="bottom-right" /></>;
}
