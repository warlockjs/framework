import type {
  QueryBuilderContract as CascadeQueryBuilder,
  QueryBuilderContract,
} from "@warlock.js/cascade";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import { BadRequestError } from "../../../http/errors/errors";
import type { FilterOptions, FilterRule, FilterRules } from "../../contracts";

dayjs.extend(customParseFormat);

/**
 * Applies repository filters to a Cascade-Next query builder
 * Translates repository filter rules into Cascade query builder method calls
 */
export class FilterApplicator {
  /**
   * Apply filters to a Cascade query builder
   *
   * @param query - Cascade query builder instance
   * @param filters - Filter structure defining how to filter
   * @param data - Data containing filter values
   * @param options - Additional filter options (date formats, etc.)
   */
  public apply(
    query: CascadeQueryBuilder<any>,
    filters: FilterRules,
    data: any,
    options: FilterOptions,
  ): void {
    // `Object.entries` hands the rule over already narrowed; a `for...in` index
    // read is `FilterRule | undefined` under the strictness contract.
    for (const [key, filterRule] of Object.entries(filters)) {
      const value = data[key];

      if (value === undefined) continue;
      if (filterRule === undefined) continue;

      const rule = this.parseFilterRule(key, filterRule);
      this.applyFilterRule(query, rule, value, data, options);
    }
  }

  /**
   * Parse a filter rule into a structured format
   */
  private parseFilterRule(key: string, rule: FilterRule) {
    // Handle custom function
    if (typeof rule === "function") {
      return { type: "function", fn: rule, column: key, key };
    }

    // Handle array format: ["operator"] or ["operator", "column"] or ["operator", ["col1", "col2"]]
    if (Array.isArray(rule)) {
      const [operator, target] = rule;

      if (target === undefined) {
        return { type: operator, column: key, columns: undefined, key };
      }

      if (Array.isArray(target)) {
        return { type: operator, column: undefined, columns: target, key };
      }

      return { type: operator, column: target, columns: undefined, key };
    }

    // Handle simple operator string
    return { type: rule, column: key, columns: undefined, key };
  }

  /**
   * Apply a single filter rule to the query
   */
  private applyFilterRule(
    query: CascadeQueryBuilder<any>,
    rule: any,
    value: any,
    data: any,
    options: FilterOptions,
  ): void {
    // 1. Custom function filter
    if (rule.type === "function") {
      rule.fn(value, query, data);
      return;
    }

    // 2. Predefined filter types
    const handler = this.getFilterHandler(rule.type);
    if (handler) {
      handler.call(this, query, rule.column, rule.columns, value, options);
      return;
    }

    // 3. Standard where operators
    this.applyWhereOperator(query, rule.type, rule.column, rule.columns, value, rule.key);
  }

  /**
   * Get filter handler for predefined types
   */
  private getFilterHandler(type: string): Function | undefined {
    const handlers: Record<string, Function> = {
      // Boolean filters
      bool: this.handleBoolean,
      boolean: this.handleBoolean,

      // Numeric filters
      int: this.handleInt,
      integer: this.handleInt,
      "!int": this.handleNotInt,
      "int>": (q: any, col: any, cols: any, val: any) =>
        this.handleIntComparison(q, col, cols, val, ">"),
      "int>=": (q: any, col: any, cols: any, val: any) =>
        this.handleIntComparison(q, col, cols, val, ">="),
      "int<": (q: any, col: any, cols: any, val: any) =>
        this.handleIntComparison(q, col, cols, val, "<"),
      "int<=": (q: any, col: any, cols: any, val: any) =>
        this.handleIntComparison(q, col, cols, val, "<="),
      inInt: this.handleInInt,
      number: this.handleNumber,
      inNumber: this.handleInNumber,
      float: this.handleFloat,
      double: this.handleFloat,
      inFloat: this.handleInNumber,

      // Null filters
      null: this.handleNull,
      notNull: this.handleNotNull,
      "!null": this.handleNotNull,

      // Date filters
      date: this.handleDate,
      "date>": (q: any, col: any, cols: any, val: any, opts: any) =>
        this.handleDateComparison(q, col, cols, val, opts, ">"),
      "date>=": (q: any, col: any, cols: any, val: any, opts: any) =>
        this.handleDateComparison(q, col, cols, val, opts, ">="),
      "date<": (q: any, col: any, cols: any, val: any, opts: any) =>
        this.handleDateComparison(q, col, cols, val, opts, "<"),
      "date<=": (q: any, col: any, cols: any, val: any, opts: any) =>
        this.handleDateComparison(q, col, cols, val, opts, "<="),
      dateBetween: this.handleDateBetween,
      inDate: this.handleInDate,

      // DateTime filters
      dateTime: this.handleDateTime,
      "dateTime>": (q: any, col: any, cols: any, val: any, opts: any) =>
        this.handleDateTimeComparison(q, col, cols, val, opts, ">"),
      "dateTime>=": (q: any, col: any, cols: any, val: any, opts: any) =>
        this.handleDateTimeComparison(q, col, cols, val, opts, ">="),
      "dateTime<": (q: any, col: any, cols: any, val: any, opts: any) =>
        this.handleDateTimeComparison(q, col, cols, val, opts, "<"),
      "dateTime<=": (q: any, col: any, cols: any, val: any, opts: any) =>
        this.handleDateTimeComparison(q, col, cols, val, opts, "<="),
      dateTimeBetween: this.handleDateTimeBetween,
      inDateTime: this.handleInDateTime,

      // Scope filter - applies local scope when value is truthy
      scope: this.handleScope,

      // With filter - eager-loads a relation when value is truthy
      with: this.handleWith,

      // JoinWith filter - eager-loads a relation via SQL JOIN when value is truthy
      joinWith: this.handleJoinWith,

      // Vector similarity search — calls similarTo(column, embedding[])
      similarTo: this.handleSimilarTo,
    };

    return handlers[type];
  }

  /**
   * `like` is a contains match on every driver: a value without an explicit
   * `%` is wrapped as `%value%` (Postgres would otherwise match exactly while
   * Mongo matched a substring). Values carrying their own `%` are kept as-is.
   */
  private likePattern(value: any): any {
    if (typeof value !== "string" || value.includes("%")) return value;
    return `%${value}%`;
  }

  /**
   * Coerce a client value to an integer or reject with a 400.
   */
  private toInt(value: any): number {
    const parsed = parseInt(value);
    if (Number.isNaN(parsed)) {
      throw new BadRequestError(`Invalid integer filter value "${value}"`);
    }
    return parsed;
  }

  /**
   * Coerce a client value to a number or reject with a 400.
   */
  private toNumber(value: any): number {
    const parsed = Number(value);
    if (value === "" || value === null || Number.isNaN(parsed)) {
      throw new BadRequestError(`Invalid number filter value "${value}"`);
    }
    return parsed;
  }

  /**
   * Apply standard where operators
   */
  private applyWhereOperator(
    query: QueryBuilderContract,
    operator: string,
    column?: string,
    columns?: string[],
    value?: any,
    ruleName?: string,
  ): void {
    // Handle "in" prefix for array values
    if (operator.startsWith("in") && operator !== "int" && !Array.isArray(value)) {
      value = [value];
    }

    // Single column
    if (column) {
      switch (operator) {
        case "=":
          query.where(column, value);
          break;
        case "!=":
        case "<>":
          query.where(column, "!=", value);
          break;
        case ">":
        case ">=":
        case "<":
        case "<=":
          query.where(column, operator, value);
          break;
        case "in":
          query.whereIn(column, Array.isArray(value) ? value : [value]);
          break;
        case "not in":
          query.whereNotIn(column, Array.isArray(value) ? value : [value]);
          break;
        case "like":
          query.whereLike(column, this.likePattern(value));
          break;
        case "startsWith":
          query.whereLike(column, `${value}%`);
          break;
        case "endsWith":
          query.whereLike(column, `%${value}`);
          break;
        case "not like":
          query.whereNotLike(column, value);
          break;
        case "between":
          query.whereBetween(column, value);
          break;
        case "not between":
          query.whereNotBetween(column, value);
          break;
      }
    }
    // Multiple columns (OR condition)
    else if (columns) {
      if (operator === "=") {
        this.anyOf(query, columns, (q, col) => q.where(col, value));
      } else if (operator === "like") {
        // (col0 LIKE value OR col1 LIKE value OR ...), OR'd with prior conditions —
        // the object form of orWhere() only ever emits "=", so "like" needs the
        // callback/group form to keep the operator instead of silently degrading
        // to equality (D1).
        this.anyOf(query, columns, (q, col) => q.where(col, "like", this.likePattern(value)));
      } else {
        // Every other operator silently degraded to equality via the object form
        // of orWhere() — refuse instead of returning a correct-looking, wrong query.
        throw new Error(
          `Unsupported multi-column filter operator "${operator}" for rule "${ruleName ?? columns.join(",")}". ` +
            `Multi-column filters only support "=" and "like".`,
        );
      }
    }
  }

  /**
   * Apply a condition across several columns as ONE grouped OR: `(a OR b OR ...)`.
   * The group is ANDed with the rest of the query, so a tenant filter
   * (`org_id = 5`) can never be widened by a multi-column search. Never emit a
   * top-level `orWhere` for multi-column filters.
   */
  private anyOf(
    query: QueryBuilderContract,
    columns: string[],
    apply: (q: QueryBuilderContract, col: string) => void,
  ) {
    query.where((group: QueryBuilderContract) => {
      columns.forEach((col, index) => {
        const build = (q: QueryBuilderContract) => apply(q, col);

        if (index === 0) {
          group.where(build);
        } else {
          group.orWhere(build);
        }
      });
    });
  }

  // ============================================================================
  // BOOLEAN FILTERS
  // ============================================================================

  /**
   * Coerce a filter value to a boolean.
   *
   * Recognized truthy forms: `true`, `1`, `"true"`, `"1"`.
   * Recognized falsy forms:  `false`, `0`, `"false"`, `"0"`.
   * Anything else falls back to `Boolean(value)`.
   *
   * NOTE: this intentionally does NOT treat "non-empty" as true — the previous
   * `|| !isEmpty(value)` fallback coerced `false`/`0` to `true`, inverting the
   * filter for explicitly-false values.
   */
  private coerceBoolean(value: any): boolean {
    if (value === true || value === 1 || value === "true" || value === "1") {
      return true;
    }

    if (value === false || value === 0 || value === "false" || value === "0") {
      return false;
    }

    return Boolean(value);
  }

  private handleBoolean(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
  ) {
    const boolValue = this.coerceBoolean(value);
    if (column) {
      query.where(column, boolValue);
    } else if (columns) {
      this.anyOf(query, columns, (q, col) => q.where(col, boolValue));
    }
  }

  // ============================================================================
  // NUMERIC FILTERS
  // ============================================================================
  private handleInt(query: QueryBuilderContract, column?: string, columns?: string[], value?: any) {
    const intValue = this.toInt(value);
    if (column) {
      query.where(column, intValue);
    } else if (columns) {
      this.anyOf(query, columns, (q, col) => q.where(col, intValue));
    }
  }

  private handleNotInt(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
  ) {
    const intValue = this.toInt(value);
    if (column) {
      query.where(column, "!=", intValue);
    } else if (columns) {
      // Grouped OR across columns
      this.anyOf(query, columns, (q, col) => q.where(col, "!=", intValue));
    }
  }

  private handleIntComparison(
    query: QueryBuilderContract,
    column: any,
    columns: any,
    value: any,
    operator: string,
  ) {
    const intValue = this.toInt(value);
    if (column) {
      query.where(column, operator, intValue);
    } else if (columns) {
      this.anyOf(query, columns, (q, col) => q.where(col, operator, intValue));
    }
  }

  private handleInInt(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
  ) {
    const values = (Array.isArray(value) ? value : [value]).map((v: any) => this.toInt(v));
    if (column) {
      query.whereIn(column, values);
    } else if (columns) {
      // Grouped OR of whereIn across columns
      this.anyOf(query, columns, (q, col) => q.whereIn(col, values));
    }
  }

  private handleNumber(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
  ) {
    const numValue = this.toNumber(value);
    if (column) {
      query.where(column, numValue);
    } else if (columns) {
      this.anyOf(query, columns, (q, col) => q.where(col, numValue));
    }
  }

  private handleInNumber(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
  ) {
    const values = (Array.isArray(value) ? value : [value]).map((v: any) => this.toNumber(v));
    if (column) {
      query.whereIn(column, values);
    } else if (columns) {
      // Grouped OR of whereIn across columns
      this.anyOf(query, columns, (q, col) => q.whereIn(col, values));
    }
  }

  private handleFloat(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
  ) {
    const floatValue = parseFloat(value);
    if (column) {
      query.where(column, floatValue);
    } else if (columns) {
      this.anyOf(query, columns, (q, col) => q.where(col, floatValue));
    }
  }

  // ============================================================================
  // NULL FILTERS
  // ============================================================================

  private handleNull(query: QueryBuilderContract, column?: string, columns?: string[]) {
    if (column) {
      query.whereNull(column);
    } else if (columns) {
      this.anyOf(query, columns, (q, col) => q.whereNull(col));
    }
  }

  private handleNotNull(query: QueryBuilderContract, column?: string, columns?: string[]) {
    if (column) {
      query.whereNotNull(column);
    } else if (columns) {
      // Use whereNotNull for each column
      this.anyOf(query, columns, (q, col) => q.whereNotNull(col));
    }
  }

  // ============================================================================
  // SCOPE FILTER
  // ============================================================================

  /**
   * Handle scope filter - applies local scope and passes the filter value.
   *
   * Usage in filterBy:
   * ```typescript
   * filterBy: {
   *   active: "scope",           // Uses the filter key as scope name
   *   isAdmin: ["scope", "admin"] // Uses custom scope name
   * }
   * ```
   *
   * When list({ active: true }) is called, it will call query.scope("active", true)
   * When list({ status: "pending" }) is called, it will call query.scope("status", "pending")
   */
  private handleScope(
    query: QueryBuilderContract,
    column?: string,
    _columns?: string[],
    value?: any,
  ) {
    // column holds the scope name (either the filter key or custom name from array format)
    if (column) {
      query.scope(column, value);
    }
  }

  // ============================================================================
  // WITH (EAGER LOAD) FILTER
  // ============================================================================

  /**
   * Handle with filter - eager-loads a relation when the filter value is truthy.
   *
   * Usage in filterBy:
   * ```typescript
   * filterBy: {
   *   with_ai_model: ["with", "ai_model"],         // load single relation
   *   with_all:      ["with", ["ai_model", "unit"]] // load multiple relations
   * }
   * ```
   *
   * When list({ with_ai_model: true }) is called, it will call query.with("ai_model")
   */
  private handleWith(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
  ) {
    if (!value) return;

    // Load a single named relation
    if (column) {
      if (query.with) {
        query.with(column);
      }
      return;
    }

    // Load multiple relations from the columns array
    if (columns) {
      for (const relation of columns) {
        if (query.with) {
          query.with(relation);
        }
      }
    }
  }

  /**
   * Handle joinWith filter - eager-loads a relation via SQL JOIN when the filter value is truthy.
   *
   * Usage in filterBy:
   * ```typescript
   * filterBy: {
   *   with_ai_model: ["joinWith", "ai_model"],         // load single relation via join
   *   with_all:      ["joinWith", ["ai_model", "unit"]] // load multiple relations via join
   * }
   * ```
   *
   * When list({ with_ai_model: true }) is called, it will call query.joinWith("ai_model")
   */
  private handleJoinWith(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
  ) {
    if (!value) return;

    if (!query.joinWith) {
      console.warn(
        "[Repository] joinWith is not supported by the query builder. using with instead.",
      );
      return this.handleWith(query, column, columns, value);
    }

    // Load a single named relation
    if (column) {
      query.joinWith(column);
      return;
    }

    // Load multiple relations from the columns array
    if (columns) {
      query.joinWith(...columns);
    }
  }

  // ============================================================================
  // VECTOR FILTER
  // ============================================================================

  /**
   * Handle similarTo filter — performs vector similarity search.
   *
   * The filter value must be a `number[]` (pre-computed embedding).
   * Delegates to `query.similarTo(column, embedding)` which is handled
   * driver-specifically (pgvector or MongoDB Atlas $vectorSearch).
   *
   * Usage in filterBy:
   * ```typescript
   * filterBy: {
   *   organization_id: "=",
   *   embedding: "similarTo",
   * }
   * ```
   *
   * Then in the service:
   * ```typescript
   * await vectorsRepository.list({ embedding: queryEmbedding, organization_id: orgId });
   * ```
   */
  private handleSimilarTo(
    query: QueryBuilderContract,
    column?: string,
    _columns?: string[],
    value?: any,
  ) {
    if (!column || !Array.isArray(value)) return;

    // Cast to any: Cascade's internal QueryBuilderContract still uses nearestTo;
    // our wrapper (CascadeQueryBuilder.similarTo) delegates to it correctly.
    (query as any).similarTo(column, value);
  }

  // ============================================================================
  // DATE FILTERS
  // ============================================================================

  private handleDate(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
    options?: FilterOptions,
  ) {
    const dateValue = this.parseDate(value, options?.dateFormat);
    if (column) {
      query.whereDate(column, dateValue);
    } else if (columns) {
      this.anyOf(query, columns, (q, col) => q.whereDate(col, dateValue));
    }
  }

  private handleDateComparison(
    query: QueryBuilderContract,
    column: any,
    columns: any,
    value: any,
    options: any,
    operator: string,
  ) {
    const dateValue = this.parseDate(value, options?.dateFormat);
    if (column) {
      if (operator === ">" || operator === ">=") {
        query.whereDateAfter(column, dateValue);
      } else {
        query.whereDateBefore(column, dateValue);
      }
    } else if (columns) {
      const after = operator === ">" || operator === ">=";
      this.anyOf(query, columns, (q, col) =>
        after ? q.whereDateAfter(col, dateValue) : q.whereDateBefore(col, dateValue),
      );
    }
  }

  private handleDateBetween(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
    options?: FilterOptions,
  ) {
    if (!Array.isArray(value) || value.length !== 2) return;
    const [start, end] = value.map((v: any) => this.parseDate(v, options?.dateFormat));

    // `value.length === 2` is checked above, so both exist — but the compiler
    // does not narrow destructured elements from a length test. Returning
    // rather than defaulting: this builds a date RANGE for a query, and a
    // half-formed range would silently filter on a boundary the caller never
    // asked for.
    if (start === undefined || end === undefined) return;

    if (column) {
      query.whereDateBetween(column, [start, end]);
    } else if (columns) {
      this.anyOf(query, columns, (q, col) => q.whereDateBetween(col, [start, end]));
    }
  }

  private handleInDate(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
    options?: FilterOptions,
  ) {
    const dates = (Array.isArray(value) ? value : [value]).map((v: any) =>
      this.parseDate(v, options?.dateFormat),
    );
    if (column) {
      query.whereIn(column, dates);
    } else if (columns) {
      // Grouped OR of whereIn across columns
      this.anyOf(query, columns, (q, col) => q.whereIn(col, dates));
    }
  }

  // ============================================================================
  // DATETIME FILTERS
  // ============================================================================

  private handleDateTime(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
    options?: FilterOptions,
  ) {
    const dateValue = this.parseDateTime(value, options?.dateTimeFormat);
    if (column) {
      query.where(column, dateValue);
    } else if (columns) {
      this.anyOf(query, columns, (q, col) => q.where(col, dateValue));
    }
  }

  private handleDateTimeComparison(
    query: QueryBuilderContract,
    column: any,
    columns: any,
    value: any,
    options: any,
    operator: string,
  ) {
    const dateValue = this.parseDateTime(value, options?.dateTimeFormat);
    if (column) {
      query.where(column, operator, dateValue);
    } else if (columns) {
      this.anyOf(query, columns, (q, col) => q.where(col, operator, dateValue));
    }
  }

  private handleDateTimeBetween(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
    options?: FilterOptions,
  ) {
    if (!Array.isArray(value) || value.length !== 2) return;
    const [start, end] = value.map((v: any) => this.parseDateTime(v, options?.dateTimeFormat));
    if (column) {
      query.whereBetween(column, [start, end]);
    } else if (columns) {
      this.anyOf(query, columns, (q, col) => q.whereBetween(col, [start, end]));
    }
  }

  private handleInDateTime(
    query: QueryBuilderContract,
    column?: string,
    columns?: string[],
    value?: any,
    options?: FilterOptions,
  ) {
    const dates = (Array.isArray(value) ? value : [value]).map((v: any) =>
      this.parseDateTime(v, options?.dateTimeFormat),
    );
    if (column) {
      query.whereIn(column, dates);
    } else if (columns) {
      // Grouped OR of whereIn across columns
      this.anyOf(query, columns, (q, col) => q.whereIn(col, dates));
    }
  }

  // ============================================================================
  // DATE PARSING UTILITIES
  // ============================================================================

  /**
   * Parse a date string with the declared format; invalid input is a 400.
   */
  private parseDate(value: any, format?: string): Date {
    return this.parseWithFormat(value, format);
  }

  /**
   * Parse a datetime string with the declared format; invalid input is a 400.
   */
  private parseDateTime(value: any, format?: string): Date {
    return this.parseWithFormat(value, format);
  }

  private parseWithFormat(value: any, format?: string): Date {
    if (value instanceof Date) return value;

    const parsed = format ? dayjs(String(value), format, true) : dayjs(value);

    if (!parsed.isValid()) {
      throw new BadRequestError(
        `Invalid date filter value "${value}"${format ? ` (expected ${format})` : ""}`,
      );
    }

    return parsed.toDate();
  }
}
