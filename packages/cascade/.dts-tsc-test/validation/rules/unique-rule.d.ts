import { type SchemaRule } from "@warlock.js/seal";
import type { UniqueRuleOptions } from "../types";
/**
 * Validates that a value is unique against a database column.
 *
 * Supports three exclusion modes:
 * - `except`: read a sibling input's value and exclude rows where that
 *   column equals the sibling's value
 * - `exceptColumnName` + `exceptValue`: exclude rows where the named
 *   column equals the supplied value (used by request-aware wrappers)
 * - Custom `query` callback for anything more involved
 *
 * @example
 * v.email().unique("User");
 * v.string().unique("User", { except: "id" });
 */
export declare const uniqueRule: SchemaRule<UniqueRuleOptions>;
//# sourceMappingURL=unique-rule.d.ts.map