/** Keep pnpm 11 native build approval local to the feature installer. */
export function mergePnpmSharpApproval(yaml: string): string {
  const block = /^allowBuilds:\s*(?:#.*)?(?:\r?\n|$)/m.exec(yaml);
  if (!block) {
    // Do not hand-edit flow YAML: preserving an existing decision is safer
    // than risking duplicate keys or discarded comments.
    if (/^(?:allowBuilds|"allowBuilds"|'allowBuilds')\s*:/m.test(yaml)) return yaml;
    return `${yaml.replace(/\s*$/, "")}\nallowBuilds:\n  sharp: true\n`;
  }

  const start = block.index + block[0].length;
  const tail = yaml.slice(start);
  const nextTopLevel = /^(?!\s|#|$)[^\r\n]+/m.exec(tail);
  const end = nextTopLevel ? start + nextTopLevel.index : yaml.length;
  const mapping = yaml.slice(start, end);
  const entry = /^(\s*)(?:sharp|"sharp"|'sharp')\s*:\s*([^#\r\n]*)(.*)$/m.exec(mapping);
  if (entry) {
    const value = entry[2]!.trim();
    if (value === "true" || value === "false") return yaml;
    if (
      !/^(?:set this to true or false|"set this to true or false"|'set this to true or false')$/.test(
        value,
      )
    )
      return yaml;
    const comment = entry[3] ?? "";
    const replacement = `${entry[1]}sharp: true${comment.startsWith("#") ? " " : ""}${comment}`;
    return `${yaml.slice(0, start)}${mapping.slice(0, entry.index)}${replacement}${mapping.slice(entry.index + entry[0].length)}${yaml.slice(end)}`;
  }
  const indentation = /^([ \t]+)\S/m.exec(mapping)?.[1] ?? "  ";
  return `${yaml.slice(0, start)}${indentation}sharp: true\n${mapping}${yaml.slice(end)}`;
}
