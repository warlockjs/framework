import { createElement, type ComponentType, type ReactNode } from "react";
import DefaultApp from "../components/default-app";
import type { HydrationDocumentPayloadSource } from "../hydration-payload";
import type { ClientProjectedModule } from "./runtime";

/** Hydrate the same document ancestry SSR used, including custom root providers. */
export function buildHydrationDocument(
  app: ClientProjectedModule | undefined,
  payload: HydrationDocumentPayloadSource,
  children: ReactNode,
): ReactNode {
  const Component =
    typeof app?.default === "function"
      ? (app.default as ComponentType<{ data: unknown; shared: unknown; children: ReactNode }>)
      : DefaultApp;
  return createElement(Component, { data: payload.appData, shared: payload.shared, children });
}
