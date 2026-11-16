/**
 * The pipeline every command runs first (owned by T-128):
 *
 * 1. `parseGrimoire(root)`;
 * 2. `buildBook(root, adapter, { routes })`;
 * 3. `matchApps`, `resolveOwnership`, `scanProofs`, `readTestResults`;
 * 4. `buildCollectedFiles`, `annotationsFrom`;
 * 5. when `write` is not `false`: `writeBook` and `writeCollectedFiles`.
 *
 * A second run with nothing changed calls no adapter method and writes no file.
 */
import type { BookAdapter } from "../contracts/adapter";
import type { GrimoireSnapshot, OpenGrimoireOptions } from "../contracts/snapshot";

/**
 * Load, refresh and return everything about the project's grimoire.
 *
 * @param root Absolute project root.
 */
export async function openGrimoire(
  root: string,
  adapter: BookAdapter,
  options: OpenGrimoireOptions = {},
): Promise<GrimoireSnapshot> {
  void root;
  void adapter;
  void options;
  throw new Error("not implemented");
}
