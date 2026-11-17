import type { DevtoolsSessionView } from "@contracts";

/**
 * What every built-in tab component receives from the shell.
 *
 * Owner: the scaffold (fixed; changes go through the coordinator).
 */
export type DevtoolsPanelProps = {
  /** The tab's part of the location hash: `#requests/abc` gives `"abc"`; `""` for the tab's first view. */
  route: string;
  /** Moves to another view of this tab (`navigate("abc")` → `#requests/abc`). */
  navigate: (route: string) => void;
  /** The instance the user picked in the header: an instance id, or `"all"` (the default). */
  instance: string;
  session: DevtoolsSessionView;
};
