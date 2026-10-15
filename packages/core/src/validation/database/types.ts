import type { BaseQueryRuleOptions, BaseUniqueRuleOptions } from "@warlock.js/cascade";

/**
 * Options for unique except current user rule
 */
export type UniqueExceptCurrentUserRuleOptions = BaseUniqueRuleOptions & {
  /** Column for current user filter (default: id) */
  exceptCurrentUserColumn?: string;
  /** Value field from current user model (default: id) */
  exceptCurrentUserValue?: string;
};

/**
 * Options for unique except current id rule
 */
export type UniqueExceptCurrentIdRuleOptions = BaseUniqueRuleOptions & {
  /** Column for current id filter (default: id) */
  exceptCurrentIdColumn?: string;
};

/**
 * Options for exists except current user rule
 */
export type ExistsExceptCurrentUserRuleOptions = BaseQueryRuleOptions & {
  /** Column for current user filter (default: id) */
  exceptCurrentUserColumn?: string;
  /** Value field from current user model (default: id) */
  exceptCurrentUserValue?: string;
};

/**
 * Options for exists except current id rule
 */
export type ExistsExceptCurrentIdRuleOptions = BaseQueryRuleOptions & {
  /** Column for current id filter (default: id) */
  exceptCurrentIdColumn?: string;
};
