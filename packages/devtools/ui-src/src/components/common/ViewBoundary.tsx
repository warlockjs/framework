import { Component, type ReactNode } from "react";
import { ErrorMessage } from "./ErrorMessage";

export type ViewBoundaryProps = {
  /** The view's name, used in the message ("The Logs view could not be shown"). */
  name: string;
  children: ReactNode;
};

type ViewBoundaryState = { error: unknown };

/**
 * Keeps one failing view from blanking the whole dashboard: the header and
 * the other tabs keep working, and the view says what failed and what to do.
 * Give it a `key` per view so opening another view starts clean.
 */
export class ViewBoundary extends Component<ViewBoundaryProps, ViewBoundaryState> {
  public override state: ViewBoundaryState = { error: null };

  public static getDerivedStateFromError(error: unknown): ViewBoundaryState {
    return { error };
  }

  public override render() {
    if (this.state.error === null) return this.props.children;

    const detail = this.state.error instanceof Error ? ` (${this.state.error.message})` : "";

    return (
      <ErrorMessage
        title={`The ${this.props.name} view could not be shown`}
        message={`It failed while drawing its data${detail}. Open another tab, or reload the page; if it keeps failing, report it with the browser console output.`}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}
