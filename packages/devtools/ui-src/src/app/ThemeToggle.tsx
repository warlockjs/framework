import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useColorScheme, type ThemeChoice } from "./useColorScheme";

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const NAME: Record<ThemeChoice, string> = { system: "system", light: "light", dark: "dark" };
const ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

/** Cycles the theme: system, light, dark. The choice is saved and applied at once. */
export function ThemeToggle() {
  const { choice, setChoice } = useColorScheme();
  const Icon = ICON[choice];

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${NAME[choice]}. Switch to ${NAME[NEXT[choice]]}.`}
      title={`Theme: ${NAME[choice]}`}
      data-theme-choice={choice}
      onClick={() => setChoice(NEXT[choice])}
    >
      <Icon />
    </Button>
  );
}
