import type { FastifyStaticOptions } from "@fastify/static";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifySchema,
  RouteHandlerMethod,
  RouteOptions,
} from "fastify";

type FileRoute = { url: string; file?: string; rootPath?: string };
type ReplyDecorator = (this: FastifyReply, ...args: unknown[]) => FastifyReply;

function optionError(field: string, message: string, valueError = false): Error {
  return Object.assign(
    valueError
      ? new TypeError(`"${field}" option ${message}`)
      : new Error(`"${field}" option ${message}`),
    {
      code: valueError ? "FST_STATIC_INVALID_OPTION_VALUE" : "FST_STATIC_INVALID_OPTION",
      statusCode: 500,
    },
  );
}

/** Validate without importing the plugin's directory-listing module. */
function staticOptions(
  server: FastifyInstance,
  options: FastifyStaticOptions,
): FastifyStaticOptions {
  const root = options.root;
  const normalize = (entry: string | URL): string | URL =>
    entry instanceof URL && entry.protocol === "file:" ? fileURLToPath(entry) : entry;
  const normalized = Array.isArray(root)
    ? root.map(normalize)
    : root === undefined
      ? undefined
      : normalize(root);
  if (options.serve !== false || normalized !== undefined) {
    if (normalized === undefined) throw optionError("root", "is required");
    if (Array.isArray(normalized) && normalized.length === 0)
      throw optionError("root", "array requires one or more paths");
    if (Array.isArray(normalized) && new Set(normalized).size !== normalized.length)
      throw optionError("root", "array contains duplicate paths");
    for (const entry of Array.isArray(normalized) ? normalized : [normalized]) {
      if (typeof entry !== "string") throw optionError("root", "must be a string", true);
      if (!path.isAbsolute(entry)) throw optionError("root", "must be an absolute path");
      try {
        if (!statSync(entry).isDirectory()) throw optionError("root", "must be a directory");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (!options.suppressWarning) server.log.warn(`"root" path "${entry}" must exist`);
      }
    }
  }
  if (options.setHeaders !== undefined && typeof options.setHeaders !== "function")
    throw optionError("setHeaders", "must be a function", true);
  if (options.serve !== false && options.wildcard && typeof options.wildcard !== "boolean")
    throw optionError("wildcard", "must be a boolean", true);
  const list = options.list;
  if (list) {
    if (Array.isArray(normalized))
      throw Object.assign(new TypeError("multi-root with list option is not supported"), {
        code: "FST_STATIC_MULTIROOT_LIST_CONFLICT",
        statusCode: 500,
      });
    if (typeof list === "object") {
      if (list.format && list.format !== "json" && list.format !== "html")
        throw optionError("list.format", "must be json or html", true);
      if (list.names && !Array.isArray(list.names))
        throw optionError("list.names", "must be an array", true);
      if (list.jsonFormat != null && list.jsonFormat !== "names" && list.jsonFormat !== "extended")
        throw optionError("list.jsonFormat", "must be names or extended", true);
      if (list.format === "html" && typeof list.render !== "function")
        throw optionError(
          "list.render",
          "must be a function and is required with html format",
          true,
        );
    }
  }
  return { ...options, root: normalized } as FastifyStaticOptions;
}

/** Mirror the plugin's boot-time route snapshot for wildcard:false. */
async function fileRoutes(options: FastifyStaticOptions, prefix: string): Promise<FileRoute[]> {
  const { glob } = await import("glob");
  const roots = Array.isArray(options.root) ? options.root : [options.root];
  const routes = new Map<string, FileRoute>();
  const indexes = new Set(
    options.index === undefined
      ? ["index.html"]
      : options.index === false
        ? []
        : [options.index].flat(),
  );
  const indexDirectories = new Map<string, string>();
  for (const root of roots) {
    if (typeof root !== "string") continue;
    const rootPath = root.split(path.win32.sep).join(path.posix.sep).replace(/\/?$/, "/");
    const files = await glob("**/**", {
      cwd: rootPath,
      absolute: false,
      follow: true,
      nodir: true,
      dot: options.serveDotFiles,
      ignore: options.globIgnore,
    });
    for (const fileName of files) {
      const file = fileName.split(path.win32.sep).join(path.posix.sep);
      const url = prefix + file;
      if (routes.has(url)) continue;
      routes.set(url, { url, file: `/${file}`, rootPath });
      // Match upstream: distinct index filenames in later roots replace the
      // directory route, while duplicate file URLs keep the first root.
      const key = path.posix.basename(url);
      if (indexes.has(key) && !indexDirectories.has(key))
        indexDirectories.set(path.posix.dirname(url), rootPath);
    }
  }
  for (const [directory, rootPath] of indexDirectories) {
    const url = directory + (directory.endsWith("/") ? "" : "/");
    const file = "/" + url.replace(prefix, "");
    routes.set(url, { url, file, rootPath });
    if (options.redirect === true)
      routes.set(url.replace(/\/$/, ""), {
        url: url.replace(/\/$/, ""),
        file: file.replace(/\/$/, ""),
        rootPath,
      });
  }
  return [...routes.values()];
}

/**
 * Queue public routes after earlier plugins, and capture upstream handlers on the
 * first file request. Only public Fastify methods are replaced on the facade;
 * the listening application's route/decorator table never changes after ready.
 */
export function registerLazyStatic(
  server: FastifyInstance,
  input: FastifyStaticOptions,
  mount: LazyStaticMount = {},
): void {
  const options = staticOptions(server, input);
  // Earlier plugins install onRoute hooks (including global rate limiting).
  // Keep the decorators on the calling scope, as @fastify/static does.
  server.register(
    Object.assign(async (instance: FastifyInstance) => prepareStatic(instance, options, mount), {
      [Symbol.for("skip-override")]: true,
    }),
  );
}

/**
 * How the file routes of one static mount meet the rate limiter.
 */
export type LazyStaticMount = {
  /**
   * The `config.rateLimit` of every file route: `false` exempts the mount
   * from the global limiter, an object gives it its own limit, and
   * `undefined` leaves it under the global policy.
   */
  rateLimit?: false | Record<string, unknown>;
};

async function prepareStatic(
  server: FastifyInstance,
  options: FastifyStaticOptions,
  mount: LazyStaticMount,
): Promise<void> {
  const originalPrefix = options.prefix ?? "/";
  const prefix =
    options.prefixAvoidTrailingSlash || originalPrefix.endsWith("/")
      ? originalPrefix
      : `${originalPrefix}/`;
  const handlers = new Map<string, RouteHandlerMethod>();
  const decorators = new Map<string, ReplyDecorator>();
  let initialized: Promise<void> | undefined;

  function initialize(): Promise<void> {
    return (initialized ??= (async () => {
      const facade = Object.create(server) as FastifyInstance;
      const capture = (route: RouteOptions): FastifyInstance => {
        const url = route.url ?? (route as RouteOptions & { path?: string }).path;
        if (!url) throw new Error("Static plugin declared a route without a path.");
        for (const method of [route.method].flat()) handlers.set(`${method} ${url}`, route.handler);
        return facade;
      };
      Object.defineProperties(facade, {
        route: { value: capture },
        get: {
          value: (
            url: string,
            route: Omit<RouteOptions, "method" | "url" | "handler">,
            handler: RouteHandlerMethod,
          ) => capture({ ...route, url, method: ["GET", "HEAD"], handler }),
        },
        decorateReply: {
          value: (name: string, handler: ReplyDecorator) => {
            decorators.set(name, handler);
            return facade;
          },
        },
      });
      const { default: staticPlugin } = await import("@fastify/static");
      await staticPlugin(facade, { ...options, decorateReply: true, suppressWarning: true });
    })());
  }

  if (options.decorateReply !== false) {
    for (const name of ["sendFile", "download"]) {
      server.decorateReply(name, function (this: FastifyReply, ...args: unknown[]) {
        void initialize()
          .then(() => {
            const decorator = decorators.get(name);
            if (!decorator) throw new Error(`Static plugin did not provide ${name}.`);
            decorator.apply(this, args);
          })
          .catch((error: unknown) => this.send(error));
        return this;
      });
    }
  }
  if (options.serve === false) return;
  const routes: FileRoute[] =
    options.wildcard === false ? await fileRoutes(options, prefix) : [{ url: prefix + "*" }];
  if (options.wildcard !== false && options.redirect === true && prefix !== originalPrefix)
    routes.push({ url: originalPrefix });
  const schema: FastifySchema & { hide: boolean } = { hide: options.schemaHide ?? true };
  for (const route of routes) {
    server.route({
      url: route.url,
      method: ["HEAD", "GET"],
      constraints: options.constraints,
      schema,
      logLevel: options.logLevel,
      config: {
        ...(route.file ? { file: route.file, rootPath: route.rootPath } : {}),
        ...(mount.rateLimit !== undefined ? { rateLimit: mount.rateLimit } : {}),
      },
      errorHandler(error, request, reply) {
        if (error?.code === "ERR_STREAM_PREMATURE_CLOSE") {
          reply.request.raw.destroy();
          return;
        }
        return server.errorHandler(error, request, reply);
      },
      async handler(request: FastifyRequest, reply: FastifyReply) {
        await initialize();
        const handler = handlers.get(`${request.method} ${route.url}`);
        if (handler) {
          await handler.call(server, request, reply);
          // Some upstream handlers start an async send without returning its
          // promise. Returning the real reply keeps Fastify from auto-sending.
          return reply;
        }
        // A wildcard:false file may disappear between boot and the first request.
        if (route.file) {
          const sendFile = decorators.get("sendFile");
          if (sendFile) return sendFile.call(reply, route.file, route.rootPath);
        }
        return reply.callNotFound();
      },
    });
  }
}
