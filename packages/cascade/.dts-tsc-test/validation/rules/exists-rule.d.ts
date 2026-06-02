import { type SchemaRule } from "@warlock.js/seal";
import type { ExistsRuleOptions } from "../types";
/**
 * Validates that a record exists in the database for the given column/value.
 *
 * @example
 * v.string().exists(Organization, { column: "id" });
 */
export declare const existsRule: SchemaRule<ExistsRuleOptions>;
//# sourceMappingURL=exists-rule.d.ts.map