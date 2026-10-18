import { parse, type ParseError } from "jsonc-parser";
export function readJsonc(text: string): { config?: Record<string, unknown>; error?: boolean } {
  const errors: ParseError[] = [];
  const config: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config))
    return { error: true };
  return { config: config as Record<string, unknown> };
}
