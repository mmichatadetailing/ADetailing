"use client";

import { Moon, Sun } from "lucide-react";
import { setAppTheme, useAppTheme } from "./theme-provider";
import { Button } from "./ui/button";

export function ThemeToggle() {
  const theme = useAppTheme();
  const label = theme === "dark" ? "Activer le mode clair" : "Activer le mode sombre";
  return <Button variant="ghost" size="icon" className="shrink-0" title={label} aria-label={label} onClick={() => setAppTheme(theme === "dark" ? "light" : "dark")}>
    <Moon className="theme-icon-light size-[18px]" aria-hidden="true" />
    <Sun className="theme-icon-dark size-[18px]" aria-hidden="true" />
  </Button>;
}
