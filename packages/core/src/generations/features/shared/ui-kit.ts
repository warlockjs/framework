import { directoryExistsAsync, fileExistsAsync, getJsonFileAsync } from "../../generation-fs";
import { rootPath, srcPath } from "../../../utils";

/** The two design-system kits. They share one component contract and exclude each other. */
export type UiKit = "shadcn" | "mantine";

export const UI_KITS: readonly UiKit[] = ["shadcn", "mantine"];

/**
 * Turn `--kit` into the feature list that implements it.
 *
 * `design-system` is the kit-neutral name: it means the shadcn kit unless
 * `--kit mantine` selects the Mantine one, which is the `mantine` feature. The
 * rewrite happens before dependencies are collected, so each kit installs only
 * its own packages.
 */
export function resolveUiKitFeatures(features: string[], kit: unknown): string[] {
  if (kit === undefined || kit === null || kit === false) return features;

  if (typeof kit !== "string" || !UI_KITS.includes(kit as UiKit)) {
    throw new Error(
      `Unknown design-system kit "${String(kit)}". Use --kit shadcn (the default) or --kit mantine.`,
    );
  }

  if (!features.includes("design-system")) {
    throw new Error(
      "--kit only applies to the design-system feature: warlock add design-system --kit <shadcn|mantine>.",
    );
  }

  if (kit === "shadcn") return features;

  if (features.includes("shadcn")) {
    throw new Error(
      "The shadcn and Mantine kits exclude each other. Pick one: drop `shadcn` from the command, or drop `--kit mantine`.",
    );
  }

  return [
    ...new Set(features.map((feature) => (feature === "design-system" ? "mantine" : feature))),
  ];
}

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

async function readManifest(): Promise<Manifest> {
  if (!(await fileExistsAsync(rootPath("package.json")))) return {};

  return getJsonFileAsync<Manifest>(rootPath("package.json"));
}

/** Which kits already live in the project, detected from dependencies and generated files. */
export async function detectInstalledUiKits(): Promise<UiKit[]> {
  const manifest = await readManifest();
  const has = (name: string) =>
    Boolean(manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]);
  const kits: UiKit[] = [];

  if (
    has("@mantine/core") ||
    (await fileExistsAsync(srcPath("web/design-system/mantine-theme.ts")))
  ) {
    kits.push("mantine");
  }

  if (
    has("radix-ui") ||
    (await fileExistsAsync(rootPath("components.json"))) ||
    (await directoryExistsAsync(srcPath("web/components/ui")))
  ) {
    kits.push("shadcn");
  }

  return kits;
}

const SWITCH_STEPS: Record<UiKit, string> = {
  shadcn:
    "remove components.json, src/web/components/ui and src/web/design-system, and uninstall radix-ui, cmdk, react-day-picker, date-fns, cn, lucide-react, class-variance-authority and tailwind-merge",
  mantine:
    "remove src/web/design-system, postcss.config.mjs and the Mantine imports from src/web/app.css and src/web/root.tsx, and uninstall the @mantine/* packages, dayjs, postcss-preset-mantine and postcss-simple-vars",
};

/**
 * Refuse to add one kit on top of the other, before anything is installed or
 * written. `requested` is the kit the resolved feature list would install.
 */
export async function assertUiKitFree(requested: UiKit): Promise<void> {
  const other: UiKit = requested === "mantine" ? "shadcn" : "mantine";

  if (!(await detectInstalledUiKits()).includes(other)) return;

  throw new Error(
    `The ${other} design-system kit is already installed, and the ${requested} kit is an alternative to it, not an addition. ` +
      `To switch, first ${SWITCH_STEPS[other]}, then run \`warlock add design-system --kit ${requested}\` again.`,
  );
}

/** Which kit a resolved feature list installs, when it installs one. */
export function requestedUiKit(resolvedFeatures: readonly string[]): UiKit | undefined {
  if (resolvedFeatures.includes("mantine")) {
    if (resolvedFeatures.includes("shadcn") || resolvedFeatures.includes("design-system")) {
      throw new Error(
        "The shadcn and Mantine kits exclude each other. Pick one: `warlock add design-system` (shadcn) or `warlock add design-system --kit mantine`.",
      );
    }

    return "mantine";
  }

  if (resolvedFeatures.includes("shadcn") || resolvedFeatures.includes("design-system")) {
    return "shadcn";
  }

  return undefined;
}
