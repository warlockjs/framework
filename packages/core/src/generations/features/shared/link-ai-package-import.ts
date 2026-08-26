import { colors } from "@mongez/copper";
import { fileExistsAsync, getFileAsync, putFileAsync } from "@warlock.js/fs";
import { srcPath } from "../../../utils";

/**
 * Link a satellite AI package into src/config/ai.ts via a side-effect import.
 *
 * The satellites (@warlock.js/ai-tools, ai-panoptic, ai-workspace) augment the
 * `ai` object on import — they register their runtime surface (ai.tools / ai.mcp,
 * ai.workspace, panoptic's ai.config({ panoptic }) wiring) AND the matching TS
 * declaration-merging so ai.* members resolve. config-loader runs config/ai.ts at
 * boot, so dropping a bare `import "<specifier>";` at the top of that file is what
 * actually loads the augmentation before the ai connector applies the config.
 *
 * No-op if config/ai.ts is missing (the `ai` feature ejects it) or the import is
 * already present. Inserts right after the `warlock:ai-packages` marker when it
 * exists so the satellite imports stay grouped; otherwise prepends to the top.
 */
export async function linkAiPackageImport(specifier: string): Promise<void> {
  const aiConfigPath = srcPath("config/ai.ts");

  if (!(await fileExistsAsync(aiConfigPath))) {
    return;
  }

  const current = await getFileAsync(aiConfigPath);
  const importLine = `import "${specifier}";`;

  if (current.includes(importLine)) {
    return;
  }

  const marker = "// >>> warlock:ai-packages (auto-managed) >>>";
  let next: string;

  if (current.includes(marker)) {
    next = current.replace(marker, `${marker}\n${importLine}`);
  } else {
    next = `${importLine}\n${current}`;
  }

  await putFileAsync(aiConfigPath, next);

  console.log(`${colors.green("✓")} Linked ${specifier} in src/config/ai.ts`);
}
