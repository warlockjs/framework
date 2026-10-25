import path from "node:path";
import type { CapabilityInfo } from "../../capabilities/capability";
import { fileModule, projectFile } from "./collect-files";
import {
  INSPECT_WIRING_ROLES,
  type InspectFile,
  type InspectWiringEntry,
  type InspectWiringRole,
} from "./inspect-report.types";

/** An auto-loaded file and the role that makes the framework import it. */
export type WiringSourceFile = {
  role: InspectWiringRole;
  /** Project-relative or absolute path. */
  file: string;
};

/**
 * The auto-loaded files read from a static scan, for a run that did not boot
 * the app: the roles in boot order, and within a role by path (routes load in
 * alphabetical order; the other roles load in discovery order, which the
 * booted pass reports exactly).
 */
export function wiringFilesFromScan(files: readonly InspectFile[]): WiringSourceFile[] {
  const sources: WiringSourceFile[] = [];

  for (const role of INSPECT_WIRING_ROLES) {
    const roleName = role === "route" ? "routes" : role;

    sources.push(
      ...files
        .filter((file) => file.role === roleName)
        .map((file) => ({ role, file: file.file }))
        .sort((a, b) => a.file.localeCompare(b.file)),
    );
  }

  return sources;
}

/**
 * The wiring section: every auto-loaded file in the order the framework loads
 * them (config first, then locales, events, `main` files, routes and workers),
 * followed by every capability slot with its provider and consumers.
 *
 * @param cwd The project root.
 * @param sources The auto-loaded files, already in load order.
 * @param capabilities The capabilities registered while the app booted.
 */
export function collectWiring(
  cwd: string,
  sources: readonly WiringSourceFile[],
  capabilities: readonly CapabilityInfo[],
): InspectWiringEntry[] {
  const relative = (file: string | null): string | null =>
    file === null ? null : path.isAbsolute(file) ? projectFile(cwd, file) : file;

  const files = sources.map((source, index): InspectWiringEntry => {
    const file = relative(source.file) ?? source.file;

    return { type: "file", role: source.role, file, module: fileModule(file), order: index + 1 };
  });

  const slots = capabilities.map((capability): InspectWiringEntry => ({
    type: "capability",
    name: capability.name,
    description: capability.description,
    required: capability.required,
    provided: capability.provided,
    definedIn: relative(capability.definedIn),
    providedBy: relative(capability.providedBy),
    consumers: capability.consumers
      .map((consumer) => relative(consumer) ?? consumer)
      .sort((a, b) => a.localeCompare(b)),
  }));

  return [...files, ...slots];
}
