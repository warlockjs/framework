import { isLazy } from "@mongez/reinforcements";
import { castToJsonSchema } from "./cast-schema";
import type { OpenApiSchema, WarningSink } from "./types";

type ResourceFieldContext = {
  /** `$ref` schema of the resource whose field is being mapped, the target of `"self"`. */
  ownerRef: OpenApiSchema;
  /** Display name used in warnings, for example `UserResource.avatar`. */
  path: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "");
}

/**
 * Owns `components.schemas`: names resource classes (by identity), builds their schemas once
 * and hands out `$ref`s, so nested, lazy and `"self"` references recurse without unrolling.
 */
export class SchemaRegistry {
  public readonly schemas: Record<string, OpenApiSchema> = {};

  private readonly resourceNames = new Map<unknown, string>();
  private readonly sharedNames = new Map<string, string>();
  private fallbackCounter = 0;

  public constructor(
    private readonly resolveName: ((resource: unknown) => string | undefined) | undefined,
    private readonly warn: WarningSink,
  ) {}

  /**
   * Register a fixed schema (an error shape shared by many operations) under a stable key.
   * Returns its `$ref`; the component name gets a numeric suffix only if a resource took it.
   */
  public shared(key: string, schema: OpenApiSchema): OpenApiSchema {
    let name = this.sharedNames.get(key);

    if (!name) {
      name = this.claim(key);
      this.sharedNames.set(key, name);
      this.schemas[name] = schema;
    }

    return { $ref: `#/components/schemas/${name}` };
  }

  /**
   * `$ref` to a resource class, building its component on first use.
   */
  public resourceRef(resource: unknown): OpenApiSchema {
    const existing = this.resourceNames.get(resource);

    if (existing) {
      return { $ref: `#/components/schemas/${existing}` };
    }

    const name = this.claim(this.nameFor(resource));
    const ref = { $ref: `#/components/schemas/${name}` };

    // Named before its fields are mapped, so a cycle resolves to this same ref.
    this.resourceNames.set(resource, name);
    this.schemas[name] = {};
    this.schemas[name] = this.buildResourceSchema(resource, name, ref);

    return ref;
  }

  /**
   * Schema of a cast string, or `{}` and a warning for an unknown cast.
   */
  public cast(cast: string, path: string, warn: WarningSink = this.warn): OpenApiSchema {
    const schema = castToJsonSchema(cast);

    if (!schema) {
      warn(`${path}: unknown cast "${cast}" is documented as {}.`);

      return {};
    }

    return schema;
  }

  /**
   * True when the function looks like a resource class: it carries a static `schema` object.
   */
  public isResourceClass(value: unknown): boolean {
    return typeof value === "function" && isRecord(Reflect.get(value, "schema"));
  }

  private nameFor(resource: unknown): string {
    const resolved = sanitizeName(this.resolveName?.(resource) ?? "");

    if (resolved && resolved !== "default") {
      return resolved;
    }

    const className = typeof resource === "function" ? sanitizeName(resource.name) : "";

    if (className && className !== "default") {
      return className;
    }

    return `Resource${++this.fallbackCounter}`;
  }

  private claim(base: string): string {
    if (!(base in this.schemas)) {
      return base;
    }

    let suffix = 2;

    while (`${base}${suffix}` in this.schemas) {
      suffix++;
    }

    return `${base}${suffix}`;
  }

  private buildResourceSchema(resource: unknown, name: string, ref: OpenApiSchema): OpenApiSchema {
    const schema = Reflect.get(resource as object, "schema");

    if (!isRecord(schema) || Object.keys(schema).length === 0) {
      this.warn(`Resource "${name}" declares no static schema and is documented as {}.`);

      return {};
    }

    const properties: Record<string, OpenApiSchema> = {};

    for (const [key, config] of Object.entries(schema)) {
      properties[key] = this.fieldSchema(config, { ownerRef: ref, path: `${name}.${key}` });
    }

    return { type: "object", properties, required: Object.keys(properties) };
  }

  private fieldSchema(config: unknown, context: ResourceFieldContext): OpenApiSchema {
    if (config === "self") {
      return context.ownerRef;
    }

    if (config === "self[]") {
      return { type: "array", items: context.ownerRef };
    }

    if (typeof config === "string") {
      return this.cast(config, context.path);
    }

    if (isLazy(config)) {
      return this.lazyFieldSchema(config, context);
    }

    if (Array.isArray(config) && config.length === 2 && typeof config[1] === "string") {
      return this.cast(config[1], context.path);
    }

    if (typeof config === "function") {
      if (this.isResourceClass(config)) {
        return this.resourceRef(config);
      }

      this.warn(`${context.path}: a resolver function has no static shape and is documented as {}.`);

      return {};
    }

    if (isRecord(config) && config.__type === "arrayOf" && isRecord(config.schema)) {
      const properties: Record<string, OpenApiSchema> = {};

      for (const [key, item] of Object.entries(config.schema)) {
        properties[key] = this.fieldSchema(item, { ...context, path: `${context.path}.${key}` });
      }

      return {
        type: "array",
        items: { type: "object", properties, required: Object.keys(properties) },
      };
    }

    this.warn(
      `${context.path}: a field builder has no static shape and is documented as {}. Declare it with a cast string to document it.`,
    );

    return {};
  }

  private lazyFieldSchema(lazy: { resolve(): unknown }, context: ResourceFieldContext): OpenApiSchema {
    let resolved: unknown;

    try {
      resolved = lazy.resolve();
    } catch (error) {
      this.warn(
        `${context.path}: a lazy resource reference could not be resolved (${
          error instanceof Error ? error.message : String(error)
        }) and is documented as {}.`,
      );

      return {};
    }

    return this.fieldSchema(resolved, context);
  }
}
