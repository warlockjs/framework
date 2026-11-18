import { useCallback, useEffect, useSyncExternalStore } from "react";

/** The person's choice: follow the system, or force one theme. */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "warlock-devtools-theme";

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** The choice kept for this page load when storage is blocked. */
let blockedChoice: ThemeChoice = "system";

/** The saved choice; `system` when nothing is saved. */
export function readThemeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);

    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return blockedChoice;
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

/** Sets the `dark` class on `<html>` for a choice. */
export function applyTheme(choice: ThemeChoice): void {
  const dark = choice === "dark" || (choice === "system" && systemPrefersDark());

  document.documentElement.classList.toggle("dark", dark);
}

/** Applies the saved theme; call once before the first render so the page does not flash. */
export function applyStoredTheme(): void {
  applyTheme(readThemeChoice());
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/**
 * The theme choice, saved in localStorage and applied as the `dark` class on
 * `<html>`. With `system` it follows `prefers-color-scheme` as it changes.
 * Every caller shares one choice, so the app root and the toggle stay in step.
 */
export function useColorScheme(): {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
} {
  const choice = useSyncExternalStore(subscribe, readThemeChoice, () => "system" as ThemeChoice);

  useEffect(() => {
    applyTheme(choice);

    if (choice !== "system" || typeof window.matchMedia !== "function") return;

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");

    query.addEventListener("change", onChange);

    return () => query.removeEventListener("change", onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage is blocked: the choice lasts until the page is reloaded.
      blockedChoice = next;
    }

    applyTheme(next);
    listeners.forEach((listener) => listener());
  }, []);

  return { choice, setChoice };
}
