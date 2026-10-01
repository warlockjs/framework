import { isPlainObject } from "@mongez/supportive-is";

/**
 * Remove the ancestors of `path` that became empty plain objects, walking from
 * the leaf's parent up to (and including) the top-level field.
 *
 * Call it right AFTER removing the leaf at `path`, and only when that leaf
 * actually existed. Gating on "the leaf existed" is what keeps an object the
 * user deliberately stored as `{}` untouched: unsetting a key that is not there
 * removes nothing, so nothing becomes empty because of the unset and nothing is
 * pruned. An ancestor is only ever pruned because THIS unset emptied it.
 *
 * Only plain objects are pruned, and only while their own container is a plain
 * object (or the root): arrays are never pruned and stop the walk, because
 * deleting an index would shift its siblings.
 *
 * @param root - The data object the path is relative to (mutated in place)
 * @param path - Dot-notation path of the leaf that was just removed
 */
export function pruneEmptyParents(root: Record<string, unknown>, path: string): void {
  const segments = path.split(".");

  // Walk upward: the ancestor at `segments.slice(0, depth)` is the candidate.
  for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
    let container: unknown = root;

    for (let index = 0; index < depth - 1; index += 1) {
      container = (container as Record<string, unknown> | undefined)?.[segments[index] as string];

      if (!isPlainObject(container)) {
        return;
      }
    }

    const key = segments[depth - 1] as string;
    const candidate = (container as Record<string, unknown>)[key];

    if (!isPlainObject(candidate) || Object.keys(candidate as object).length > 0) {
      return;
    }

    delete (container as Record<string, unknown>)[key];
  }
}
