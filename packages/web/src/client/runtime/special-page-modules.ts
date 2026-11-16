import { lazy, type ComponentType } from "react";
import type { SerializedErrorPageProps } from "../../hydration-payload";
import type { ClientProjectedModule, ClientRouteComposition } from "./types";

/**
 * The route's error page module: the one already in the composition, else the
 * one its on-demand loader fetches. `undefined` when the app has no error page.
 */
export async function loadErrorPageModule(
  composition: ClientRouteComposition,
): Promise<ClientProjectedModule | undefined> {
  return composition.ErrorPage ?? (await composition.loadErrorPage?.());
}

/** The route's forbidden page module, resolved like {@link loadErrorPageModule}. */
export async function loadForbiddenPageModule(
  composition: ClientRouteComposition,
): Promise<ClientProjectedModule | undefined> {
  return composition.ForbiddenPage ?? (await composition.loadForbiddenPage?.());
}

const lazyErrorPages = new WeakMap<object, ComponentType<SerializedErrorPageProps>>();

/**
 * The route's error page as a component a boundary can render without having
 * loaded it. A page already in the composition is returned as-is; one behind
 * the on-demand loader becomes a lazy component, so its chunk is requested
 * only when a boundary actually renders it (inside a `Suspense`, see
 * `ErrorPageRenderGuard`). `undefined` when the route has no error page.
 */
export function errorPageComponentOf(
  composition: ClientRouteComposition,
): ComponentType<SerializedErrorPageProps> | undefined {
  if (composition.ErrorPage !== undefined) {
    const component = composition.ErrorPage.default;

    return typeof component === "function"
      ? (component as ComponentType<SerializedErrorPageProps>)
      : undefined;
  }

  const loader = composition.loadErrorPage;

  if (loader === undefined) return undefined;

  let component = lazyErrorPages.get(loader);

  if (component === undefined) {
    component = lazy(async () => {
      const module = await loader();
      const page = module.default;

      if (typeof page !== "function") {
        throw new TypeError("The error page module has no default component.");
      }

      return { default: page as ComponentType<SerializedErrorPageProps> };
    });
    lazyErrorPages.set(loader, component);
  }

  return component;
}
