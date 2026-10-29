import type { UiKit } from "../commands/create-new-app/types";

export const UI_KIT_CHOICES: readonly UiKit[] = ["shadcn", "mantine", "none"];

const KIT_FEATURES = ["shadcn", "mantine", "design-system"];

/**
 * Merge `--ui` into the feature list.
 *
 * `shadcn` and `mantine` are alternatives: both would write the same
 * `src/web/design-system` contract files, so a list holding both is refused
 * here instead of failing later inside `warlock add`. `--ui=none` means no kit,
 * and refuses a feature list that names one.
 */
export function applyUiKit(features: string[], ui: string | undefined): string[] {
  if (ui !== undefined && !UI_KIT_CHOICES.includes(ui as UiKit)) {
    throw new Error(`Unknown --ui value "${ui}". Use one of: ${UI_KIT_CHOICES.join(", ")}.`);
  }

  const withShadcn = features.includes("shadcn");
  const withMantine = features.includes("mantine");

  if (withShadcn && withMantine) {
    throw new Error(
      "The shadcn and Mantine kits exclude each other. Select one of them (--ui=shadcn or --ui=mantine).",
    );
  }

  if (ui === "none") {
    const named = features.filter((feature) => KIT_FEATURES.includes(feature));
    if (named.length > 0) {
      throw new Error(`--ui=none conflicts with --features ${named.join(",")}.`);
    }
    return features;
  }

  if (ui === "mantine" && withShadcn) {
    throw new Error("--ui=mantine conflicts with the shadcn feature. Pick one UI kit.");
  }

  if (ui === "shadcn" && withMantine) {
    throw new Error("--ui=shadcn conflicts with the mantine feature. Pick one UI kit.");
  }

  const kit = ui ?? (withMantine ? "mantine" : withShadcn ? "shadcn" : undefined);
  const withKit = kit === undefined ? features : [...new Set([...features, kit])];

  // shadcn always brings the shared controls along, as before.
  return withKit.includes("shadcn") ? [...new Set([...withKit, "design-system"])] : withKit;
}
