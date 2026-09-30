import type { Route } from "../router/types";

/**
 * A JSON Schema fragment (OpenAPI 3.1 schemas are JSON Schema 2020-12).
 */
export type OpenApiSchema = Record<string, unknown>;

export type OpenApiParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  style?: "deepObject";
  explode?: boolean;
  schema: OpenApiSchema;
};

export type OpenApiRequestBody = {
  required?: boolean;
  content: Record<string, { schema: OpenApiSchema }>;
};

export type OpenApiResponse = {
  description: string;
  content?: Record<string, { schema: OpenApiSchema }>;
};

export type OpenApiSecurityRequirement = Record<string, string[]>;

export type OpenApiOperation = {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  security?: OpenApiSecurityRequirement[];
};

export type OpenApiSecurityScheme =
  | { type: "http"; scheme: "bearer"; bearerFormat?: string }
  | { type: "apiKey"; in: "cookie"; name: string };

export type OpenApiComponents = {
  schemas?: Record<string, OpenApiSchema>;
  securitySchemes?: Record<string, OpenApiSecurityScheme>;
};

export type OpenApiDocument = {
  openapi: "3.1.0";
  jsonSchemaDialect: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  tags?: { name: string }[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: OpenApiComponents;
};

/**
 * The `validation.response` configuration keys that shape a failed-validation response.
 * Every key is optional; the documented defaults apply to the missing ones.
 */
export type OpenApiValidationResponseConfig = {
  errors?: string;
  inputKey?: string;
  inputError?: string;
  status?: number;
};

/**
 * Everything the builder needs besides the routes. Plain values only, so the same call
 * serves the CLI child and the in-process dev path.
 */
export type OpenApiContext = {
  info: { title: string; version: string; description?: string };
  /** Absolute server URLs, first is the default. */
  servers?: string[];
  /** Also document page (SSR) routes. Defaults to `false`. */
  includePages?: boolean;
  /**
   * Name a resource class for `components.schemas`, usually its export name
   * (`UserResource`). Return `undefined` for an unknown resource: it is named
   * `Resource1`, `Resource2`, ... in encounter order.
   */
  resolveResourceName?: (resource: unknown) => string | undefined;
  /** The app's `validation.response` config value. */
  validationResponse?: OpenApiValidationResponseConfig;
};

export type OpenApiBuildResult = {
  document: OpenApiDocument;
  warnings: string[];
};

/** The slice of a route the builder reads. A full `Route` satisfies it. */
export type OpenApiRouteInput = Pick<Route, "method" | "path" | "handler"> &
  Partial<
    Pick<Route, "name" | "label" | "description" | "middleware" | "isPage" | "sourceFile">
  >;

/**
 * The descriptor `authMiddleware()` attaches under `Symbol.for("warlock.auth")`.
 * Read structurally and validated; core never imports the auth package.
 */
export type AuthDescriptor = {
  sources: ("header" | { cookie: string })[];
  userTypes: string[];
};

export type WarningSink = (message: string) => void;
