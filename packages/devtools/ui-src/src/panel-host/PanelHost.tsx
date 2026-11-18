import { useEffect, useRef, useState } from "react";
import { buildPanelContext } from "./context";
import type { LegacyPanelContext } from "./types";
import { loadPanelModule } from "./modules";
import { LoaderCircleIcon } from "lucide-react";
import { ErrorMessage } from "@/components/common/ErrorMessage";

export type PanelHostProps = {
  /** The package panel's id. */
  id: string;
  /** The tab title, used in error messages. */
  title: string;
  /** The panel's part of the hash: `#grimoire/flow/checkout` gives `flow/checkout`. */
  route: string;
  /** Behind a read-only share link: loads the shared view and calls `api/share/*`. */
  shared?: boolean;
  /** The context's `share` value for a normal mount (see `LegacyPanelContext.share`). */
  share?: LegacyPanelContext["share"];
};

/**
 * Mounts a package panel's view module (`panels/<id>/view.js`) inside the
 * shell. The module is imported once per page load and called with the 5.55.0
 * panel context; whatever it renders goes into an element this component
 * owns, and it renders again on `refresh()` and when the panel's route
 * changes. While the module and its first render are pending it shows a
 * "Loading <title>…" note; a failed module shows an error that says what to check.
 */
export function PanelHost({ id, title, route, shared = false, share = null }: PanelHostProps) {
  const container = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    const host = container.current;

    if (!host) return;

    setError(null);
    setLoading(!host.hasChildNodes());

    const refresh = () => setTick((value) => value + 1);

    (async () => {
      let module;

      try {
        module = await loadPanelModule(id, shared);
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

      const result = await module.default(buildPanelContext({ id, root, route, refresh, shared, share }));

      if (!current) return;

      host.replaceChildren(result instanceof Node ? result : root);
      setLoading(false);
    })().catch((reason: unknown) => {
      if (!current) return;

      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    });

    return () => {
      current = false;
    };
    // `share` is an object built per render: only its content matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, title, route, tick, shared, share?.enabled, share?.manageHref]);

  return (
    <>
      {error ? (
        <ErrorMessage message={error} title={`The ${title} panel could not be shown`} />
      ) : null}
      {loading && !error ? (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground"
        >
          <LoaderCircleIcon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          Loading {title}…
        </div>
      ) : null}
      <div ref={container} data-panel-host={id} />
    </>
  );
}
