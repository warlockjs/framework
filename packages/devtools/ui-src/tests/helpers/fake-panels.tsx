import { vi } from "vitest";

/**
 * Replaces the built-in tab components with small stand-ins that print what
 * the shell passed them. Call at the top of a spec: `vi.mock("@/panels/registry", ...)`
 * must be hoisted, so the spec calls `fakeRegistry()` inside the factory.
 */
export async function fakeRegistry() {
  const ids = ["requests", "queries", "routes", "resources", "health", "errors", "logs", "jobs", "mail", "ai", "agents", "api"];
  const make = (id: string) =>
    function FakePanel(props: { route: string; instance: string }) {
      return <p>{`tab:${id} route:${props.route} instance:${props.instance}`}</p>;
    };

  return {
    BUILT_IN_PANELS: Object.fromEntries(ids.map((id) => [id, make(id)])),
    isBuiltInPanel: (id: string) => ids.includes(id),
  };
}

export const noop = vi.fn();
