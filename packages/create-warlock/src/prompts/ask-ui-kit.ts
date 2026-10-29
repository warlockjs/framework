import { cancel, isCancel, select } from "@clack/prompts";

/** The customize wizard can tick both kits; they exclude each other, so ask which one stays. */
export async function resolveKitConflict(selected: string[]): Promise<string[]> {
  if (!selected.includes("shadcn") || !selected.includes("mantine")) return selected;

  const kit = await select({
    message: "shadcn and Mantine exclude each other. Keep which one?",
    options: [
      { value: "shadcn", label: "shadcn/ui + Tailwind" },
      { value: "mantine", label: "Mantine" },
    ],
    initialValue: "shadcn",
  });

  if (isCancel(kit)) {
    cancel("Setup cancelled");
    process.exit(0);
  }

  return selected.filter((feature) => feature !== (kit === "shadcn" ? "mantine" : "shadcn"));
}
