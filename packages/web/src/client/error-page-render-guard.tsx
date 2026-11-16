import { Component, createElement, Suspense, type ComponentType, type ReactNode } from "react";
import type { SerializedErrorPageProps } from "../hydration-payload";
import { renderBuiltInFallback } from "./built-in-error-fallback";

type ErrorPageRenderGuardProps = {
  ErrorPage: ComponentType<SerializedErrorPageProps>;
  errorPageProps: SerializedErrorPageProps;
};

type ErrorPageRenderGuardState = {
  failed: boolean;
};

/**
 * The NESTED guard `render()` below delegates to. An app's `error.page.tsx`
 * is ordinary application code and can throw itself — rendering it directly
 * inside `DefaultErrorBoundary` would re-enter the very state
 * `getDerivedStateFromError` just set, which is not a second failure, it is
 * the same boundary catching its own fallback in a loop. This class exists
 * so that failure has somewhere to land that is not `DefaultErrorBoundary`
 * itself: it falls back to the floor's fixed message and reports nothing —
 * `DefaultErrorBoundary.componentDidCatch` already reported the ORIGINAL
 * failure once, and that is the one report this whole floor promises.
 */
export class ErrorPageRenderGuard extends Component<
  ErrorPageRenderGuardProps,
  ErrorPageRenderGuardState
> {
  public state: ErrorPageRenderGuardState = { failed: false };

  public static getDerivedStateFromError(): ErrorPageRenderGuardState {
    return { failed: true };
  }

  public render(): ReactNode {
    if (this.state.failed) {
      return renderBuiltInFallback();
    }

    // The page may be a lazy component (its chunk loads when an error is first
    // shown), so it renders inside a Suspense. A chunk that fails to load
    // throws into this guard and lands on the built-in fallback above.
    return createElement(
      Suspense,
      { fallback: null },
      createElement(this.props.ErrorPage, this.props.errorPageProps),
    );
  }
}
