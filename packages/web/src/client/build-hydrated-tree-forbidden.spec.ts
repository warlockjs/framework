import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { LevelErrorBoundary, buildHydratedTree } from "./build-hydrated-tree";
import type { ClientPageEntry, ClientRouteComposition } from "./runtime/types";
import type {
  HydrationDocumentPayloadSource,
  SerializedErrorPageProps,
} from "../hydration-payload";

type LevelProps = { data: unknown; shared: unknown; children?: ReactNode };

const Page = (_props: LevelProps): null => null;
const Layout = (_props: LevelProps): null => null;
const ErrorPage = (_props: SerializedErrorPageProps): null => null;
const ForbiddenPage = (_props: SerializedErrorPageProps): null => null;

const moduleOf = (component: unknown) => ({ default: component });

function payloadWithStatus(status: number): HydrationDocumentPayloadSource {
  return {
    name: "staff",
    locale: "en",
    translations: {},
    appData: {},
    layoutData: {},
    pageData: {},
    shared: { locale: "en" },
    errorPage: { error: { name: "ForbiddenError", message: "Forbidden" }, status },
  };
}

function entry(composition: ClientRouteComposition): ClientPageEntry {
  return { type: "page", name: "staff", path: "/staff", load: () => composition };
}

/** The leaf element type of the composed tree, looking through layouts and boundaries. */
function leafTypeOf(node: ReactNode): unknown {
  let current = node;
  let leaf: unknown;

  while (isValidElement(current)) {
    const element = current as ReactElement<LevelProps>;

    if (element.type !== LevelErrorBoundary) leaf = element.type;
    current = element.props.children as ReactNode;
  }

  return leaf;
}

const withBoth: ClientRouteComposition = {
  Page: moduleOf(Page),
  ErrorPage: moduleOf(ErrorPage),
  ForbiddenPage: moduleOf(ForbiddenPage),
  layouts: [moduleOf(Layout)],
};

describe("buildHydratedTree: forbidden page", () => {
  it.each([401, 403])("hydrates the ForbiddenPage for a %i failure", async (status) => {
    const tree = await buildHydratedTree([entry(withBoth)], payloadWithStatus(status));

    expect(leafTypeOf(tree)).toBe(ForbiddenPage);
  });

  it.each([404, 500])("hydrates the ErrorPage for a %i failure", async (status) => {
    const tree = await buildHydratedTree([entry(withBoth)], payloadWithStatus(status));

    expect(leafTypeOf(tree)).toBe(ErrorPage);
  });

  it("falls back to the ErrorPage for a 403 when the app has no forbidden page", async () => {
    const tree = await buildHydratedTree(
      [entry({ Page: moduleOf(Page), ErrorPage: moduleOf(ErrorPage), layouts: [] })],
      payloadWithStatus(403),
    );

    expect(leafTypeOf(tree)).toBe(ErrorPage);
  });

  it("hydrates a forbidden-only app for a 403", async () => {
    const tree = await buildHydratedTree(
      [entry({ Page: moduleOf(Page), ForbiddenPage: moduleOf(ForbiddenPage), layouts: [] })],
      payloadWithStatus(403),
    );

    expect(leafTypeOf(tree)).toBe(ForbiddenPage);
  });
});
