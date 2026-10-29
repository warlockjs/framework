import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import type { ReactNode } from "react";
import { defaultColorScheme, theme } from "./mantine-theme";

/**
 * Mounts Mantine's theme, the modals manager and the notifications host around
 * the page. Render it once in `src/web/root.tsx`, around `#vessel`.
 */
export default function DesignSystemProvider({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme={defaultColorScheme}>
      <ModalsProvider>
        <Notifications />
        {children}
      </ModalsProvider>
    </MantineProvider>
  );
}

/**
 * Sets the stored or system colour scheme on `<html>` before first paint, so a
 * dark-mode visitor never sees a light flash. Render it inside `<head>`.
 */
export function DesignSystemColorScheme({ nonce }: { nonce?: string }) {
  return <ColorSchemeScript defaultColorScheme={defaultColorScheme} nonce={nonce} />;
}
