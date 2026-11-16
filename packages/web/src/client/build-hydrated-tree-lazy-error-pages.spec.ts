import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LevelErrorBoundary, buildHydratedTree } from "./build-hydrated-tree";
import type { ClientPageEntry, ClientRouteComposition } from "./runtime/types";
import type {
  HydrationDocumentPayloadSource,
  SerializedErrorPageProps,
} from "../hydration-payload";

type LevelProps = { data: unknown; shared: unknown; children?: ReactNode };

const Page = (_props: LevelProps): null => null;
const ErrorPage = (_props: SerializedErrorPageProps): null => null;
const ForbiddenPage = (_props: SerializedErrorPageProps): null => null;

const moduleOf = (component: unknown) => ({ default: component });

function payload(status?: number): HydrationDocumentPayloadSource {
  return {
    name: "staff",
    locale: "en",
    translations: {},
    appData: {},
    layoutData: {},
    pageData: {},
    shared: { locale: "en" },
    ...(status === undefined
      ? {}
      : { errorPage: { error: { name: "Error", message: "Failed" }, status } }),
  };
}

function entry(composition: ClientRouteComposition): ClientPageEntry {
  return { type: "page", name: "staff", path: "/staff", load: () => composition };
}

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

function lazyComposition() {
  const loadErrorPage = vi.fn(async () => moduleOf(ErrorPage));
  const loadForbiddenPage = vi.fn(async () => moduleOf(ForbiddenPage));
  const composition: ClientRouteComposition = {
    Page: moduleOf(Page),
    layouts: [],
    loadErrorPage,
    loadForbiddenPage,
  };

  return { composition, loadErrorPage, loadForbiddenPage };
}

describe("buildHydratedTree: on-demand error and forbidden pages", () => {
  it("loads neither page for an ordinary payload", async () => {
    const { composition, loadErrorPage, loadForbiddenPage } = lazyComposition();

    const tree = await buildHydratedTree([entry(composition)], payload());

    expect(leafTypeOf(tree)).toBe(Page);
    expect(loadErrorPage).not.toHaveBeenCalled();
    expect(loadForbiddenPage).not.toHaveBeenCalled();
  });

  it("loads only the error page for a 500 payload", async () => {
    const { composition, loadErrorPage, loadForbiddenPage } = lazyComposition();

    const tree = await buildHydratedTree([entry(composition)], payload(500));

    expect(leafTypeOf(tree)).toBe(ErrorPage);
    expect(loadErrorPage).toHaveBeenCalledTimes(1);
    expect(loadForbiddenPage).not.toHaveBeenCalled();
  });

  it("loads only the forbidden page for a 403 payload", async () => {
    const { composition, loadErrorPage, loadForbiddenPage } = lazyComposition();

    const tree = await buildHydratedTree([entry(composition)], payload(403));

    expect(leafTypeOf(tree)).toBe(ForbiddenPage);
    expect(loadForbiddenPage).toHaveBeenCalledTimes(1);
    expect(loadErrorPage).not.toHaveBeenCalled();
  });

  it("falls back to the error page for a 403 when there is no forbidden page", async () => {
    const { composition, loadErrorPage } = lazyComposition();
    const { loadForbiddenPage: _unused, ...withoutForbidden } = composition;

    const tree = await buildHydratedTree([entry(withoutForbidden)], payload(403));

    expect(leafTypeOf(tree)).toBe(ErrorPage);
    expect(loadErrorPage).toHaveBeenCalledTimes(1);
  });

  it("hands the page-level boundary a lazy error page without loading it", async () => {
    const { composition, loadErrorPage } = lazyComposition();

    const tree = (await buildHydratedTree([entry(composition)], payload())) as ReactElement<{
      ErrorPage?: unknown;
    }>;

    expect(tree.type).toBe(LevelErrorBoundary);
    expect(tree.props.ErrorPage).toBeDefined();
    expect(loadErrorPage).not.toHaveBeenCalled();
  });
});
