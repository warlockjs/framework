import { useEffect, useRef, useState } from "react";
import { buildPanelContext } from "./context";
import { loadPanelModule } from "./modules";
import { ErrorMessage } from "@/components/common/ErrorMessage";

export type PanelHostProps = {
  /** The package panel's id. */
  id: string;
  /** The tab title, used in error messages. */
  title: string;
  /** The panel's part of the hash: `#grimoire/flow/checkout` gives `flow/checkout`. */
  route: string;
};

/**
 * Mounts a package panel's view module (`panels/<id>/view.js`) inside the
 * shell. The module is imported once per page load and called with the 5.55.0
 * panel context; whatever it renders goes into an element this component
 * owns, and it renders again on `refresh()` and when the panel's route
 * changes. A failed module shows an error that says what to check.
 */
export function PanelHost({ id, title, route }: PanelHostProps) {
  const container = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const host = container.current;

    if (!host) return;

    setError(null);

    const refresh = () => setTick((value) => value + 1);

    (async () => {
      let module;

      try {
        module = await loadPanelModule(id);
      } catch (reason) {
        const detail = reason instanceof Error ? reason.message : String(reason);

        throw new Error(
          `The ${title} panel's view module did not load (${detail}). Check the server log.`,
        );
      }

      if (typeof module?.default !== "function") {
        throw new Error(
          `The ${title} panel's view module has no default export function. Check the panel package.`,
        );
      }

      const root = document.createElement("section");

      root.className = "panel";
      root.dataset.panel = id;

      const result = await module.default(buildPanelContext({ id, root, route, refresh }));

      if (!current) return;

      host.replaceChildren(result instanceof Node ? result : root);
    })().catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      current = false;
    };
  }, [id, title, route, tick]);

  return (
    <>
      {error ? <ErrorMessage message={error} /> : null}
      <div ref={container} data-panel-host={id} />
    </>
  );
}
