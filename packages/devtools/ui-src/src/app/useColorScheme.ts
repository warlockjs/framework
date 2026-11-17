import { useEffect } from "react";

/** Follows `prefers-color-scheme`: sets the `dark` class on `<html>` and keeps it in step with the system. */
export function useColorScheme(): void {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", query.matches);

    apply();
    query.addEventListener("change", apply);

    return () => query.removeEventListener("change", apply);
  }, []);
}
