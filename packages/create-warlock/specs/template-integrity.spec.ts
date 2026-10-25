import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static integrity checks for the scaffolded `templates/warlock` tree.
 *
 * These tests read template files as TEXT and assert they line up with the
 * CURRENT framework surface. They never execute a template, so they stay inside
 * the create-warlock isolation boundary while still catching the kind of drift
 * that has shipped broken scaffolds before (e.g. the `text(N)` -> `string(N)`
 * migration-column regression).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(here, "..", "templates", "warlock");

function read(relativePath: string): string {
  return readFileSync(path.join(templateRoot, relativePath), "utf8");
}

/**
 * Strip `//` and block comments from a source string.
 *
 * The checks below hunt for banned CODE. The template documents each ban in a
 * comment right where it used to live ("this used to read `request.client`…"),
 * and matching the prose would fail on the very explanation of the fix — so the
 * commentary is removed before the source is searched.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Every `.ts`/`.tsx` file under the template's `src`, as paths relative to the
 * template root (so they can be handed straight to {@link read}).
 */
function templateSourceFiles(): string[] {
  const files: string[] = [];

  const walk = (relativeDir: string) => {
    for (const entry of readdirSync(path.join(templateRoot, relativeDir), {
      withFileTypes: true,
    })) {
      const relativePath = path.posix.join(relativeDir, entry.name);

      if (entry.isDirectory()) {
        walk(relativePath);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(relativePath);
      }
    }
  };

  walk("src");

  return files;
}

const migrationTemplates = [
  "src/app/users/models/user/migrations/11-12-2025_23-58-03-user.migration.ts",
  "src/app/posts/models/post/migrations/09-01-2026_02-07-51-post.migration.ts",
  "src/app/auth/models/otp/migrations/22-12-2025_10-30-20.otp-migration.ts",
];

/**
 * The complete set of standalone column helpers exported by
 * `@warlock.js/cascade` (see `cascade/src/migration/column-helpers.ts`, which is
 * re-exported through `cascade/src/migration/index.ts` -> `cascade/src/index.ts`).
 * `Migration` itself is the factory class living in the same package.
 *
 * Kept in sync with source by hand on purpose: this list is the oracle the
 * drift guard compares the templates against, so it must be grounded in the
 * real exports, not assumed.
 */
const cascadeColumnExports = new Set<string>([
  "Migration",
  // string family
  "string",
  "char",
  "text",
  "mediumText",
  "longText",
  // numeric family
  "integer",
  "int",
  "smallInteger",
  "smallInt",
  "tinyInteger",
  "tinyInt",
  "bigInteger",
  "bigInt",
  "float",
  "double",
  "decimal",
  // boolean
  "boolCol",
  "bool",
  // date / time
  "date",
  "dateTime",
  "timestamp",
  "time",
  "year",
  // json / binary
  "json",
  "objectCol",
  "binary",
  "blobCol",
  // identifiers
  "uuid",
  "ulid",
  // network
  "ipAddress",
  "macAddress",
  // spatial
  "point",
  "polygon",
  "lineString",
  "geometry",
  // ai / ml
  "vector",
  // enum / set
  "enumCol",
  "setCol",
  // postgres arrays
  "arrayInt",
  "arrayBigInt",
  "arrayFloat",
  "arrayDecimal",
  "arrayBoolean",
  "arrayText",
  "arrayDate",
  "arrayTimestamp",
  "arrayUuid",
  "arrayJson",
]);

/**
 * Pull the named imports out of the FIRST `import { ... } from "<module>"` that
 * targets the given module in a source string. Returns the bare identifiers.
 */
function namedImportsFrom(source: string, moduleName: string): string[] {
  const pattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${moduleName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    )}["']`,
    "m",
  );
  const match = source.match(pattern);

  if (!match) return [];

  return match[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) =>
      entry
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim(),
    );
}

describe("migration templates use only current cascade column helpers", () => {
  it.each(migrationTemplates)(
    "imports nothing from cascade that the framework does not export: %s",
    (templatePath) => {
      const source = read(templatePath);
      const imported = namedImportsFrom(source, "@warlock.js/cascade");

      expect(imported.length).toBeGreaterThan(0);

      const unknown = imported.filter((name) => !cascadeColumnExports.has(name));

      expect(unknown).toEqual([]);
    },
  );

  it.each(migrationTemplates)(
    "never calls text() with a length argument — text() is unlimited, fixed-length must use string(N): %s",
    (templatePath) => {
      const source = read(templatePath);

      // The exact drift a prior session fixed: text(255) is invalid because the
      // cascade helper `text()` takes no arguments. Guard against it returning.
      expect(source).not.toMatch(/\btext\s*\(\s*\d/);
    },
  );

  it.each(migrationTemplates)(
    "passes a length only to helpers that accept one (string/char/decimal/vector/enum/set): %s",
    (templatePath) => {
      const source = read(templatePath);

      // Collect every `helper(<args>)` call whose first arg is numeric, then make
      // sure the helper is one that legitimately takes a numeric/sized argument.
      const sizedCalls = [...source.matchAll(/\b([a-zA-Z]+)\s*\(\s*\d/g)].map((match) => match[1]);

      const helpersThatTakeArgs = new Set(["string", "char", "decimal", "vector", "smallInteger"]);

      const offenders = sizedCalls.filter(
        (helper) => cascadeColumnExports.has(helper) && !helpersThatTakeArgs.has(helper),
      );

      expect(offenders).toEqual([]);
    },
  );

  it("user migration declares the columns the user schema relies on", () => {
    const source = read(migrationTemplates[0]);

    // Spot-check the regression-prone columns are present and sized via string().
    expect(source).toMatch(/name:\s*string\(\d+\)/);
    expect(source).toMatch(/email:\s*string\(\d+\)\.unique\(\)/);
    expect(source).toMatch(/password:\s*string\(\d+\)/);
  });

  it("post migration keeps description as unbounded text() with no length", () => {
    const source = read(migrationTemplates[1]);

    expect(source).toMatch(/description:\s*text\(\)/);
    expect(source).not.toMatch(/description:\s*text\(\d/);
  });
});

/**
 * Fast tripwires for the specific drift that shipped a template a fresh project
 * could not typecheck.
 *
 * These are NOT the real gate — the real gate is `npm run typecheck:scaffold`
 * (`scripts/typecheck-scaffold.mjs`), which scaffolds and installs a project and
 * runs its own `tsc --noEmit`. That takes minutes and needs the network. These
 * assertions cost milliseconds and catch each known regression by name, so the
 * common case is caught on `npm test` instead of at the end of a CI install.
 */
describe("template typecheck prerequisites", () => {
  const tsconfig = read("tsconfig.json");

  it("does not point typeRoots at a file — it takes directories of @types packages", () => {
    // The original bug: `"typeRoots": ["./src/typings.d.ts"]`. Wrong twice —
    // typeRoots wants directories, and that path did not exist at all.
    expect(tsconfig).not.toMatch(/"typeRoots"\s*:\s*\[[^\]]*\.d\.ts/);
  });

  it("ships src/typings.d.ts and lists it on include", () => {
    expect(() => read("src/typings.d.ts")).not.toThrow();
    expect(tsconfig).toMatch(/"include"\s*:\s*\[[^\]]*src\/typings\.d\.ts/);
  });

  it("resolves modules the way the framework's exports maps require", () => {
    // Every @warlock.js package ships an `exports` map. Classic "node"
    // resolution ignores it, so subpaths like `@warlock.js/core/tests` fail to
    // typecheck even though they run.
    expect(tsconfig).toMatch(/"moduleResolution"\s*:\s*"bundler"/i);
    expect(tsconfig).not.toMatch(/"moduleResolution"\s*:\s*"node"/i);
  });

  it("declares request augmentations as interface, never type — merging is interface-only", () => {
    const typings = stripComments(read("src/typings.d.ts"));

    expect(typings).toMatch(/declare module ["']@warlock\.js\/core["']/);
    expect(typings).toMatch(/interface RequestLocals\b/);
    expect(typings).toMatch(/interface RequestUser\b/);

    // A `type X = {...}` inside the augmentation block does not merge — it is a
    // duplicate-identifier error against the framework's own declaration.
    expect(typings).not.toMatch(/type\s+RequestLocals\s*=/);
    expect(typings).not.toMatch(/type\s+RequestUser\s*=/);
  });

  it("keeps src/typings.d.ts a module, so `declare module` augments instead of replacing", () => {
    const typings = read("src/typings.d.ts");

    // Without a top-level import/export this file is a SCRIPT, and
    // `declare module "@warlock.js/core"` then declares an AMBIENT module that
    // wipes out every real export of the package.
    expect(typings).toMatch(/^export\s*\{\s*\}\s*;?\s*$/m);
  });

  it("never reads request.client — v5 removed the index signature that allowed it", () => {
    const offenders = templateSourceFiles().filter((file) =>
      /\brequest\.client\b/.test(stripComments(read(file))),
    );

    expect(offenders).toEqual([]);
  });

  it("starts the scheduler it registers jobs on", () => {
    // Registering jobs does not schedule them. Without start(), a fresh
    // project's first `warlock dev` warns and neither cleanup job ever runs.
    const authMain = read("src/app/auth/main.ts");

    expect(authMain).toMatch(/scheduler\.newJob\(/);
    expect(authMain).toMatch(/scheduler\.start\(\)/);
  });

  it("router utils never export a helper whose name implies an admin boundary it does not enforce", () => {
    // `guardedAdmin()` used to wrap `authMiddleware([])` — an EMPTY allow-list,
    // which per authMiddleware's own contract means "any authenticated user,
    // type not checked" (auth/src/middleware/auth.middleware.ts). Pairing that
    // with an `/admin` prefix and a name that says "admin" promised a boundary
    // the code never enforced: the scaffold registers only a `user` type, so
    // any signed-in user could pass. The helper is removed rather than fixed
    // in place, so guard against it (or an equivalent) coming back.
    const source = read("src/app/shared/utils/router.ts");

    expect(source).not.toMatch(/guardedAdmin/);

    // Every `authMiddleware(` call using an EMPTY allow-list must live inside a
    // helper whose own JSDoc says it allows any authenticated user type — so a
    // future "admin"-sounding wrapper around an empty list is still caught even
    // if it avoids the literal name `guardedAdmin`. Comments are kept (not
    // stripped) here on purpose: the JSDoc itself is what this check reads.
    const emptyListCalls = [...source.matchAll(/authMiddleware\(\s*\[\s*\]/g)];

    for (const call of emptyListCalls) {
      const precedingSource = source.slice(0, call.index);
      const enclosingFunctionStart = precedingSource.lastIndexOf("export function");

      expect(enclosingFunctionStart).toBeGreaterThan(-1);

      const precedingComment = precedingSource.slice(0, enclosingFunctionStart);
      const lastBlockComment = precedingComment.match(/\/\*\*[\s\S]*?\*\/\s*$/);

      expect(lastBlockComment).not.toBeNull();
      expect(lastBlockComment![0]).toMatch(/any authenticated user/i);
    }
  });

  it("postgres database config's clientOptions carries a database key — PostgresPoolConfig requires it", () => {
    // `PostgresPoolConfig` (cascade) is `PostgresConnectionConfig & {...}`, and
    // `PostgresConnectionConfig.database` is a REQUIRED string, not optional —
    // unlike Mongo's `MongoClientOptions`, which needs no such key. An empty
    // `clientOptions: {}` on the postgres template is `{}` assigned to a type
    // that requires `database`, so a freshly scaffolded `--db=postgres` project
    // fails `tsc --noEmit` on this file before a single line of app code runs.
    const source = stripComments(read("src/config/database.postgres.ts"));
    const clientOptionsMatch = source.match(/clientOptions:\s*\{([\s\S]*?)\n {2}\},/);

    expect(clientOptionsMatch).not.toBeNull();
    expect(clientOptionsMatch![1]).toMatch(/\bdatabase\s*:/);
  });
});

describe("user model's verified scope matches @warlock.js/auth's emailVerifiedAt semantics", () => {
  // @warlock.js/auth (74c2517) stamps `auth.verification.field` — default
  // `emailVerifiedAt`, a nullable Date — on `verifyEmail()`, and its own
  // `isEmailVerified()` treats "verified" as the field holding a value. The
  // scaffold's `verified` scope, schema and migration must agree with that:
  // there is no `emailVerified` boolean anywhere in the framework surface.
  const userModel = () => read("src/app/users/models/user/user.model.ts");
  const userMigration = () => read(migrationTemplates[0]);

  it("never queries a boolean emailVerified column — auth stamps emailVerifiedAt instead", () => {
    expect(stripComments(userModel())).not.toMatch(/\bemailVerified\b(?!At)/);
  });

  it("verified scope checks emailVerifiedAt is not null", () => {
    const source = stripComments(userModel());
    const scopeMatch = source.match(
      /addScope\(\s*["']verified["'],\s*\(query\)\s*=>\s*\{([\s\S]*?)\}\s*\)/,
    );

    expect(scopeMatch).not.toBeNull();
    expect(scopeMatch![1]).toMatch(/whereNotNull\(\s*["']emailVerifiedAt["']\s*\)/);
  });

  it("user schema declares emailVerifiedAt as an optional date", () => {
    const source = stripComments(userModel());

    expect(source).toMatch(/emailVerifiedAt:\s*v\.date\(\)\.optional\(\)/);
  });

  it("user migration declares emailVerifiedAt as a nullable timestamp", () => {
    const source = stripComments(userMigration());

    expect(source).toMatch(/emailVerifiedAt:\s*timestamp\(\)\.nullable\(\)/);
  });
});

describe("locale switching never falls back to a banned import or a reload", () => {
  it("never imports @mongez/http — use the framework's own request/response surface", () => {
    const offenders = templateSourceFiles().filter((file) =>
      /from\s*["']@mongez\/http["']/.test(stripComments(read(file))),
    );

    expect(offenders).toEqual([]);
  });

  it("never pairs a locale change with location.reload or a hash-based reload", () => {
    // The regression this guards: a locale switcher that posts the new locale
    // then forces the browser to re-fetch the whole document via
    // `location.hash` / `location.reload()` instead of using the framework's
    // `changeLocaleCode`, which swaps the page in without a reload.
    const localeReloadPattern =
      /\blocale\b[\s\S]{0,400}?location\.(reload|hash)|location\.(reload|hash)[\s\S]{0,400}?\blocale\b/i;

    const offenders = templateSourceFiles().filter((file) =>
      localeReloadPattern.test(stripComments(read(file))),
    );

    expect(offenders).toEqual([]);
  });
});

describe("cache config's globalPrefix is fixed and app-owned, not request-derived", () => {
  // `originDomain`, the `domain` header and `?domain=` input are either
  // request-shaped (a GET has no Origin, a POST does — the same visitor gets
  // two prefixes) or outright visitor-controlled (any `?domain=` value picks
  // a namespace). Either way the default scaffold must not read them: a
  // fresh app's cache prefix has to be the same for every request.
  const cacheConfig = () => stripComments(read("src/config/cache.ts"));

  it("default globalPrefix never reads originDomain, a domain header, or domain input", () => {
    const source = cacheConfig();
    const globalPrefixMatch = source.match(/const globalPrefix = \(\) => env\("APP_NAME"[\s\S]*?;/);

    expect(globalPrefixMatch).not.toBeNull();
    expect(source).not.toMatch(/originDomain/);
    expect(source).not.toMatch(/header\(\s*["']domain["']\s*\)/);
    expect(source).not.toMatch(/input\(\s*["']domain["']\s*\)/);
  });
});

describe("the scaffolded root is mobile-ready", () => {
  it("leaves the viewport tag to <Head />, so the document never carries two", () => {
    const root = stripComments(read("src/web/root.tsx"));

    expect(root).toContain("<Head />");
    expect(root).not.toMatch(/<meta\s+name="viewport"/);
  });
});

describe("lint toolchain source templates", () => {
  it("ships only Oxc with correctness errors and import sorting", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.devDependencies.typescript).toBe("7.0.2");
    expect(pkg.devDependencies.oxlint).toBe("1.88.0");
    expect(Object.keys(pkg.devDependencies).filter((name) => /eslint|prettier/.test(name))).toEqual(
      [],
    );
    const lint = JSON.parse(read(".oxlintrc.json"));
    const format = JSON.parse(read(".oxfmtrc.json"));
    expect(lint.categories.correctness).toBe("error");
    expect(lint.rules["typescript/no-explicit-any"]).toBe("error");
    expect(lint.rules.curly).toBe("error");
    expect(lint.rules["no-console"]).toBe("error");
    expect(lint.rules["typescript/explicit-member-accessibility"][0]).toBe("error");
    expect(lint.rules["typescript/consistent-type-imports"][0]).toBe("error");
    expect(format.sortImports).toEqual({
      newlinesBetween: false,
      internalPattern: ["app/", "web/", "@shared/"],
    });
  });

  it("runs every package script through the local binary, never npx", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.lint).toBe("oxlint --fix ./src --max-warnings=0");
    expect(pkg.scripts["lint:check"]).toBe("oxlint ./src --max-warnings=0");
    for (const [name, script] of Object.entries<string>(pkg.scripts)) {
      expect(script, name).not.toMatch(/(^|&&\s*|\|\|\s*)npx\s/);
    }
  });
});

describe("framework conventions are verified by warlock check", () => {
  it("installs no Warlock lint plugin", () => {
    const pkg = JSON.parse(read("package.json"));
    const devDependencies = Object.keys(pkg.devDependencies);

    expect(devDependencies.filter((name) => name.startsWith("@warlock.js/"))).toEqual([]);
    expect(read("../toolchains/oxc/.oxlintrc.json")).not.toContain("@warlock.js/");
  });

  it("tells agents to run warlock check for the conventions it enforces", () => {
    const agents = read("AGENTS.md");

    expect(agents).toContain("npx warlock check");
    for (const code of ["WL9005", "WL9006", "WL9007", "WL9008", "WL9009"]) {
      expect(agents).toContain(code);
    }
    expect(read("skills/code-standards/SKILL.md")).toContain("npx warlock check");
    expect(read("skills/security-baseline/SKILL.md")).toContain("WL9007");
  });
});

describe("web template UI and setup contracts", () => {
  it.each([
    ["src/web/home/index.page.tsx", "src/web/home/index.setup.ts"],
    ["src/web/root.tsx", "src/web/root.setup.ts"],
    ["src/web/404.page.tsx", "src/web/404.setup.ts"],
    ["src/web/forbidden.page.tsx", "src/web/forbidden.setup.ts"],
  ])("keeps %s as UI with policy in %s", (uiFile, setupFile) => {
    const ui = stripComments(read(uiFile));
    const setup = stripComments(read(setupFile));

    expect(ui).toMatch(/export default function/);
    expect(ui).not.toMatch(
      /export\s+(?:const|(?:async\s+)?function)\s+(?:config|loader|register|action|actions|metadata)\b/,
    );
    expect(ui).not.toMatch(/export\s*\{[^}]*\bregister\b/);
    expect(setup).toMatch(/export const config/);
    expect(setup).not.toMatch(/export default/);
    expect(setup).not.toMatch(/export\s+(?:const|(?:async\s+)?function)\s+metadata\b/);
  });

  it("types home data through a type-only setup loader import", () => {
    const page = read("src/web/home/index.page.tsx");
    const setup = read("src/web/home/index.setup.ts");

    expect(page).toContain('import type { loader } from "./index.setup"');
    expect(page).toContain("PageProps<typeof loader>");
    expect(setup).toContain("export async function loader");
    expect(setup).toContain("export function register");
    expect(setup).toContain("satisfies PageConfig<typeof loader>");
    expect(setup).toContain("metadata: {");
    expect(read("src/web/404.setup.ts")).toContain('title: "Page not found"');
  });
});

describe("project skill contracts", () => {
  it("keeps discovery descriptions concise and links independent of installation paths", () => {
    for (const name of readdirSync(path.join(templateRoot, "skills"))) {
      const source = read(`skills/${name}/SKILL.md`);
      const description = source.match(/^description: (["'])([^\n]+)\1$/m)?.[2];
      expect(description, name).toBeDefined();
      expect(description?.length, name).toBeLessThanOrEqual(450);
      expect(source, name).not.toMatch(/(?:skills\/|\.\.\/)[\w-]+\/SKILL\.md/);
      expect(source, name).not.toMatch(/@warlock\.js\/[^/`]+\/[^`]*SKILL\.md/);
      expect(source, name).not.toMatch(/async \(\s*request,\s*response/);
      expect(source, name).not.toContain("v.uuid()");
    }
  });

  it("generates separate public UUIDs and resolves public route IDs by that column", () => {
    for (const [module, model] of [
      ["users", "user"],
      ["posts", "post"],
    ]) {
      expect(read(`src/app/${module}/models/${model}/${model}.model.ts`)).toMatch(
        /publicId:\s*v\s*\.string\(\)\s*\.uuid\(\)\s*\.default\(\(\)\s*=>\s*randomUUID\(\)\)/,
      );
      expect(read(`src/app/${module}/resources/${model}.resource.ts`)).toContain(
        'id: ["publicId", "string"]',
      );
    }
    for (const migration of migrationTemplates.slice(0, 2)) {
      expect(read(migration)).toContain("publicId: string(36).unique()");
    }
    expect(read("src/app/posts/controllers/update-post.controller.ts")).toContain(
      "Post.first({ publicId: id })",
    );
    expect(read("src/app/posts/schema/update-post.schema.ts")).toContain("id: v.string().uuid()");
    expect(read("src/app/users/controllers/list-users.controller.ts")).toContain("pagination,");
  });

  it("declares resource response schemas on the changed sample controllers", () => {
    for (const file of [
      "src/app/users/controllers/list-users.controller.ts",
      "src/app/users/controllers/create-new-user.controller.ts",
      "src/app/posts/controllers/create-new-post.controller.ts",
      "src/app/posts/controllers/update-post.controller.ts",
      "src/app/contact/controllers/contact.controller.ts",
      "src/app/locale/controllers/locale.controller.ts",
    ]) {
      expect(read(file), file).toContain(".responseSchema =");
      expect(read(file), file).toContain('error: { code: "string", message: "string" }');
    }
  });

  it("configures the domain mapper and transport formatter together", () => {
    expect(read("src/config/http.ts")).toContain("errorMapper: () => ({ status: 500 })");
    expect(read("src/config/http.ts")).toContain("errorResponse: formatHttpErrorResponse");
    expect(read("src/web/home/hooks/use-contact-form.ts")).toContain("body.error?.message");
    expect(read("src/web/home/hooks/use-contact-form.ts")).toContain("errors: body.details");
  });
});

describe("starter controller response contracts", () => {
  it("declares a response schema on every exported controller", () => {
    const controllers = templateSourceFiles().filter((file) => file.includes("/controllers/"));
    expect(controllers.length).toBeGreaterThan(0);
    for (const file of controllers) {
      const source = stripComments(read(file));
      const name = /export const (\w+)/.exec(source)?.[1];
      expect(name, file).toBeDefined();
      expect(source, file).toContain(`${name}.responseSchema =`);
    }
  });
});
