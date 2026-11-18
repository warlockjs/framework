import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/listing";
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
      <PageHeader
        title="API"
        description="The reference for every route, generated from your app. Pick a viewer, or download the OpenAPI file or Postman collection."
      >
        <Button asChild variant="outline" size="sm">
          <a href="api/openapi.json" download="openapi.json">
            <DownloadIcon />
            OpenAPI JSON
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href="api/postman.json" download="postman.json">
            <DownloadIcon />
            Postman collection
          </a>
        </Button>
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Viewer">
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
      </div>
      <iframe
        key={viewer.id}
        className="h-[75vh] w-full rounded-xl border bg-background"
        src={viewer.src}
        title="API reference"
      />
    </div>
  );
}
