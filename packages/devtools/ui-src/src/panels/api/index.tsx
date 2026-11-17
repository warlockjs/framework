import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ToggleButton } from "@/components/ui/panel-kit";
import type { DevtoolsPanelProps } from "@/panels/types";

const VIEWERS = [
  { id: "scalar", label: "Scalar", src: "docs" },
  { id: "swagger", label: "Swagger UI", src: "docs/swagger" },
] as const;

export const DOCS_VIEWER_KEY = "warlock-devtools-docs-viewer";

function savedViewer(): (typeof VIEWERS)[number] {
  try {
    const id = localStorage.getItem(DOCS_VIEWER_KEY);

    return VIEWERS.find((viewer) => viewer.id === id) ?? VIEWERS[0];
  } catch {
    return VIEWERS[0];
  }
}

function saveViewer(id: string): void {
  try {
    localStorage.setItem(DOCS_VIEWER_KEY, id);
  } catch {
    // Storage can be blocked; the choice then lasts until the page is reloaded.
  }
}

/** The API tab: the Scalar or Swagger UI reference in a frame, and the OpenAPI and Postman downloads. */
export function ApiPanel(_props: DevtoolsPanelProps) {
  const [viewer, setViewer] = useState(savedViewer);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {VIEWERS.map((item) => (
          <ToggleButton
            key={item.id}
            active={item.id === viewer.id}
            onClick={() => {
              saveViewer(item.id);
              setViewer(item);
            }}
          >
            {item.label}
          </ToggleButton>
        ))}
        <Button asChild variant="link" size="sm">
          <a href="api/openapi.json" download="openapi.json">
            OpenAPI JSON
          </a>
        </Button>
        <Button asChild variant="link" size="sm">
          <a href="api/postman.json" download="postman.json">
            Postman collection
          </a>
        </Button>
      </div>
      <iframe key={viewer.id} className="h-[75vh] w-full rounded-md border" src={viewer.src} title="API reference" />
    </div>
  );
}
