import { createElement, Fragment, type ReactNode } from "react";
import type { PageErrorDetails } from "./document-context";

/**
 * The development error panel: the message, the stage the failure happened
 * in, the page file, the route and the stack, under whatever error page the
 * app renders.
 *
 * It only ever receives details the server built outside production
 * (`SerializedErrorPageProps.debug`), so a production response has nothing to
 * draw it from. Plain elements and inline styles: it must render even when the
 * app's own stylesheet or components are the thing that failed.
 */
export function DevErrorPanel({ details }: { details: PageErrorDetails }): ReactNode {
  const rows: Array<[string, string | undefined]> = [
    ["Phase", details.level === undefined ? details.phase : `${details.phase} (${details.level})`],
    ["Page file", details.file],
    ["Route", details.routePath],
    ["Site", details.site],
    ["Request", details.requestId],
  ];

  return createElement(
    "aside",
    {
      "data-warlock-dev-error": "",
      style: {
        margin: "1rem",
        padding: "1rem",
        border: "2px solid #c62828",
        borderRadius: "6px",
        background: "#fff5f5",
        color: "#111",
        font: "13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
        textAlign: "left",
        direction: "ltr",
      },
    },
    createElement("strong", null, `${details.name}: ${details.message}`),
    createElement(
      "dl",
      { style: { margin: "0.5rem 0" } },
      ...rows.flatMap(([label, value]) =>
        value === undefined
          ? []
          : [
              createElement(Fragment, { key: label }, [
                createElement("dt", { key: "t", style: { fontWeight: "bold" } }, label),
                createElement("dd", { key: "d", style: { margin: "0 0 0.25rem 0" } }, value),
              ]),
            ],
      ),
    ),
    details.stack === undefined
      ? null
      : createElement(
          "pre",
          { style: { margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" } },
          details.stack,
        ),
  );
}

/** The element to draw next to an error page outside production; `null` when there is nothing to show. */
export function devErrorPanelElement(details: PageErrorDetails | undefined): ReactNode {
  return details === undefined ? null : createElement(DevErrorPanel, { details });
}
