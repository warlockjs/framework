export const accessConfigStub = `import { type AccessConfigurations } from "@warlock.js/access";
import { DatabaseAccessResolver } from "app/access/services/access-resolver";

/**
 * Authorization configuration — read by @warlock.js/access on boot.
 *
 * The resolver is the one required piece: it tells the engine how to read a
 * user's roles + permissions. The ejected DatabaseAccessResolver reads roles
 * from the user_roles table and maps them through the roles catalog table (so
 * roles + their permissions are managed at runtime, in the DB).
 *
 * For a fixed, code-defined catalog with no tables, swap in DefaultAccessResolver:
 *   import { DefaultAccessResolver } from "@warlock.js/access";
 *   resolver: new DefaultAccessResolver({ admin: ["*"], editor: ["orders.*"] }),
 *
 * Multi-tenant? Add a \`resolveTenant()\` to the resolver to read the active
 * tenant from the request; checks then scope to it automatically.
 */
const access: AccessConfigurations = {
  resolver: new DatabaseAccessResolver(),

  // Cache resolved permission sets (default "10m").
  // cache: { ttl: "10m" },
};

export default access;
`;

export const aiConfigStub = `import type { AIConfig } from "@warlock.js/ai";

// >>> warlock:ai-packages (auto-managed) >>>
// Satellite packages augment the "ai" object on import — e.g. ai.workspace,
// ai.tools / ai.mcp, and panoptic's ai.config({ panoptic }) wiring. The command
// "warlock add ai-workspace | ai-tools | ai-panoptic" adds the matching
// side-effect import below; keep them so the augmentation + runtime registration
// load before the ai connector applies this config.
// <<< warlock:ai-packages <<<

/**
 * AI configuration — applied on boot by the ai connector, which calls
 * ai.config(...) with the object below. Cross-cutting defaults live here
 * (shared cache / snapshot stores, observability); per-call options always win.
 *
 * Wire a default model from a provider you installed, e.g.:
 *   import { OpenAISDK } from "@warlock.js/ai-openai";
 *   const openai = OpenAISDK({ apiKey: env("OPENAI_API_KEY") });
 *   // then pass openai.model({ name: "gpt-4o-mini" }) into your agents.
 */
const ai: Partial<AIConfig> = {
  // Default cache driver for cache-backed AI features (semantic cache, rag / memory vector stores).
  // defaultStore: cache.driver("redis", { client }),

  // Observability — requires "warlock add ai-panoptic". Exporters + the local dashboard.
  // panoptic: { exporters: [], dashboard: false, observeAll: false },
};

export default ai;
`;

export const accessRoleModelStub = `import { Model, RegisterModel } from "@warlock.js/cascade";
import { type Infer, v } from "@warlock.js/seal";

/**
 * Validation schema for the roles catalog — mirrors the migration columns
 * (snake_case). Each row is a role name plus the permission strings it grants;
 * wildcards work ("orders.*", "*"). The DatabaseAccessResolver maps a user's
 * assigned role names through this table to their effective permissions.
 */
export const roleSchema = v.object({
  name: v.string(),
  permissions: v.array(v.string()).default([]),
});

export type RoleSchema = Infer<typeof roleSchema>;

/**
 * The roles catalog — role name → the permissions it grants. Managed at runtime
 * (admins add roles + edit their permissions), unlike a fixed code map. Read by
 * DatabaseAccessResolver.resolvePermissions to expand a user's roles to permissions.
 */
@RegisterModel()
export class Role extends Model<RoleSchema> {
  public static table = "roles";

  public static schema = roleSchema;

  /** The permission strings this role grants. */
  public get permissions(): string[] {
    return this.get<string[]>("permissions", []);
  }
}
`;

export const accessRoleModelIndexStub = `export * from "./role.model";
`;

export const accessRoleMigrationStub = `import { arrayText, Migration, text } from "@warlock.js/cascade";
import { Role } from "../role.model";

/**
 * Roles catalog table. \`name\` is unique (one row per role); \`permissions\` is a
 * text array of the permission strings the role grants.
 */
export default Migration.create(Role, {
  name: text().notNullable().unique(),
  permissions: arrayText().nullable(),
});
`;

export const accessUserRoleModelStub = `import { access } from "@warlock.js/access";
import type { Auth } from "@warlock.js/auth";
import { Model, RegisterModel } from "@warlock.js/cascade";
import { type Infer, v } from "@warlock.js/seal";

/**
 * Validation schema for a role assignment — mirrors the migration columns
 * (snake_case). \`tenant\` is nullable: a null tenant is a GLOBAL assignment.
 */
export const userRoleSchema = v.object({
  user_id: v.string(),
  user_type: v.string(),
  role: v.string(),
  tenant: v.string().optional(),
});

export type UserRoleSchema = Infer<typeof userRoleSchema>;

/**
 * The role-assignment table — which roles a user holds, optionally per tenant.
 * Read by DatabaseAccessResolver.resolveRoles; mutated via the statics below.
 * \`assign\` / \`revoke\` flush the cached permission set automatically, so callers
 * never need to call \`access.flush(user, tenant)\` themselves.
 */
@RegisterModel()
export class UserRole extends Model<UserRoleSchema> {
  public static table = "user_roles";

  public static schema = userRoleSchema;

  /**
   * Role names assigned to the user in the given tenant.
   *
   * An unresolved tenant (\`undefined\`) scopes to GLOBAL roles only — the rows
   * stored with no tenant (\`null\`) — never the union across every tenant. The
   * union would be a privilege-escalation: a user who is \`owner\` in one tenant
   * must not be treated as \`owner\` everywhere just because a check didn't carry
   * a tenant. This mirrors how \`assign(user, role)\` stores a global row.
   */
  public static async rolesFor(user: Auth, tenant?: string): Promise<string[]> {
    const rows = await this.query()
      .where({
        user_id: user.id,
        user_type: user.userType,
        tenant: tenant ?? null,
      })
      .get();

    // De-dupe so a duplicate row (a concurrent assign that slipped past the
    // existence check) can't distort the resolved set.
    return [...new Set(rows.map((row) => row.get("role") as string))];
  }

  /**
   * Assign a role to the user. No-op if the assignment already exists.
   * Flushes the user's cached permission set automatically.
   */
  public static async assign(user: Auth, role: string, tenant?: string): Promise<void> {
    const existing = await this.first({
      user_id: user.id,
      user_type: user.userType,
      role,
      tenant: tenant ?? null,
    });

    if (existing) return;

    await this.create({
      user_id: user.id,
      user_type: user.userType,
      role,
      tenant,
    });

    await access.flush(user, tenant);
  }

  /**
   * Remove a role assignment from the user.
   * Flushes the user's cached permission set automatically.
   */
  public static async revoke(user: Auth, role: string, tenant?: string): Promise<void> {
    await this.delete({
      user_id: user.id,
      user_type: user.userType,
      role,
      tenant: tenant ?? null,
    });

    await access.flush(user, tenant);
  }
}
`;

export const accessUserRoleModelIndexStub = `export * from "./user-role.model";
`;

export const accessUserRoleMigrationStub = `import { Migration, text, uuid } from "@warlock.js/cascade";
import { UserRole } from "../user-role.model";

/**
 * Role-assignment table. \`user_id\` is a UUID — override this migration if your
 * user ids are integers. The composite index powers the per-user (per-tenant)
 * lookup the resolver runs on every check.
 */
export default Migration.create(
  UserRole,
  {
    user_id: uuid().notNullable().index(),
    user_type: text().notNullable(),
    role: text().notNullable().index(),
    tenant: text().nullable().index(),
  },
  {
    index: [{ columns: ["user_id", "user_type", "tenant"] }],
  },
);
`;

export const accessResolverStub = `import type { AccessResolver } from "@warlock.js/access";
import type { Auth } from "@warlock.js/auth";
import { Role } from "app/access/models/role";
import { UserRole } from "app/access/models/user-role";

/**
 * The app's access adapter — connects @warlock.js/access to the ejected role
 * tables. Roles come from the user_roles assignment table; permissions are
 * expanded by mapping those role names through the roles catalog table. Both
 * are managed at runtime (in the DB), so admins can add roles + edit their
 * permissions without a deploy.
 *
 * The engine owns the hard parts (wildcard matching, caching, fail-closed); this
 * resolver only fetches — keep it dumb, never cache inside it.
 */
export class DatabaseAccessResolver implements AccessResolver {
  /** The role names this user holds (powers \`hasRole\` / \`hasAnyRole\`). */
  public async resolveRoles(user: Auth, tenant?: string): Promise<string[]> {
    return UserRole.rolesFor(user, tenant);
  }

  /** The effective permission strings this user has (powers \`can\` / \`authorize\`). */
  public async resolvePermissions(user: Auth, tenant?: string): Promise<string[]> {
    const names = await this.resolveRoles(user, tenant);

    if (names.length === 0) return [];

    const roles = await Role.query().whereIn("name", names).get();

    // Flatten + de-dupe so two roles granting the same permission yield one entry.
    return [...new Set(roles.flatMap((role) => role.permissions))];
  }

  /**
   * Optional. Resolve the ambient tenant when a check doesn't pass one
   * explicitly — derive it from the authenticated user (safer than reading
   * client request input, which a caller could spoof). Uncomment + adapt for a
   * multi-tenant app (single-tenant apps leave this off and return undefined).
   */
  // public resolveTenant(user: Auth): string | undefined {
  //   return user.get("organization_id");
  // }
}
`;

export const socketConfigStub = `import type { SocketOptions } from "@warlock.js/core";

/**
 * Socket.IO configuration — read by the framework's socket connector
 * on boot. When the HTTP server is running the socket server attaches
 * to it; otherwise it listens on its own configured port.
 *
 * Remove this file to disable the socket server entirely.
 */
export default {
  options: {
    cors: {
      origin: "*",
    },
  },
} as SocketOptions;
`;

export const communicatorsConfigStub = `import { env } from "@warlock.js/core";
import type { BrokerConfigurations, RabbitMQClientOptions } from "@warlock.js/herald";

const heraldConfigurations: BrokerConfigurations<RabbitMQClientOptions> = {
  driver: "rabbitmq",
  name: "default",
  isDefault: true,

  // ============================================================================
  // Connection Settings
  // ============================================================================

  host: env("RABBITMQ_HOST", "localhost"),
  port: env("RABBITMQ_PORT", 5672),
  username: env("RABBITMQ_USERNAME", "guest"),
  password: env("RABBITMQ_PASSWORD", "guest"),
  vhost: env("RABBITMQ_VHOST", "/"),

  // Or use connection URI (takes precedence over host/port)
  // uri: env("RABBITMQ_URL"),

  // ============================================================================
  // Connection Options
  // ============================================================================

  /** Heartbeat interval in seconds */
  heartbeat: 60,

  /** Connection timeout in milliseconds */
  connectionTimeout: 10000,

  /** Enable automatic reconnection on disconnect */
  reconnect: true,

  /** Delay between reconnection attempts in milliseconds */
  reconnectDelay: 5_000,

  // ============================================================================
  // Consumer Options
  // ============================================================================

  /** Default prefetch count (number of unacknowledged messages per consumer) */
  prefetch: 10,

  // ============================================================================
  // Client Options (Native amqplib options)
  // ============================================================================
  // These options are passed directly to amqplib.connect()
  // for low-level configuration like frame size, TLS, socket options, etc.
  // ============================================================================
  clientOptions: {
    // Frame max size in bytes (0 = no limit)
    // frameMax: 0,

    // Channel max (0 = unlimited)
    // channelMax: 0,

    // Socket options
    socket: {
      // Enable TCP keep-alive
      keepAlive: true,

      // Disable Nagle's algorithm for lower latency
      noDelay: true,

      // Socket timeout (in addition to heartbeat)
      // timeout: 30000,
    },

    // TLS/SSL options (uncomment for secure connections)
    // socket: {
    //   ca: fs.readFileSync('/path/to/ca.pem'),
    //   cert: fs.readFileSync('/path/to/cert.pem'),
    //   key: fs.readFileSync('/path/to/key.pem'),
    //   rejectUnauthorized: true,
    // },
  },
};

export default heraldConfigurations;
`;

export const notificationsConfigStub = `import { type NotificationConfig, inApp, mailChannel } from "@warlock.js/notifications";
import { Notification } from "app/notifications/notification.model";

/**
 * Notifications configuration. Auto-loaded from src/config on boot — the
 * framework's notifications connector reads this default export and hands it to
 * setNotificationConfig, so this file stays declarative (no side-effect call).
 *
 * Each channel is payload-typed, so notify.mail(...) / notify.database(...)
 * and defineNotification are type-checked against the registry.
 *
 * Channels enabled here:
 *   - mail     wraps @warlock.js/core sendMail; route is notifiable.email.
 *              The "from" address defaults to config/mail.ts; override per
 *              channel with mailChannel({ from: "no-reply@yourapp.com" }).
 *   - database in-app store backed by the Notification model. The "inApp"
 *              facade exposes the recipient-scoped read API: listUnread,
 *              countUnread, markAsRead, dismiss, ...
 *
 * Async delivery (.queue()) is OPTIONAL: run "npx warlock add herald",
 * import { heraldQueue } from "@warlock.js/notifications", and uncomment the
 * queue line below.
 */
const config: NotificationConfig = {
  channels: {
    mail: mailChannel(),
    database: inApp.configure({ model: Notification }),
  },

  // Async queue — requires @warlock.js/herald (npx warlock add herald):
  // queue: heraldQueue(),
};

export default config;
`;

export const notificationModelStub = `import { RegisterModel } from "@warlock.js/cascade";
import { DatabaseNotification, type NotificationColumnMap } from "@warlock.js/notifications";
import { v } from "@warlock.js/seal";

/**
 * Validation schema for the notifications table — mirrors the migration
 * columns (snake_case). Cascade validates + casts every write against it:
 * nullable columns use .nullish() (may be absent or null), and payload is
 * free-form JSON. Keep this in sync with the migration + columnMap when you
 * add or rename columns.
 */
const notificationSchema = v.object({
  user_id: v.string(),
  type: v.string(),
  title: v.string(),
  body: v.string().nullish(),
  payload: v.record(v.any()).nullish(),
  read_at: v.date().nullish(),
  idempotency_key: v.string().nullish(),
});

/**
 * In-app notification model.
 *
 * Extends the package's DatabaseNotification base, which provides the stable
 * accessors (recipientId, tenantId, isRead, readAt, markRead) — all derived
 * from the columnMap below. The read/write API lives on the inApp facade
 * (configured in config/notifications.ts); you rarely touch this class directly.
 */
@RegisterModel()
export class Notification extends DatabaseNotification {
  public static table = "notifications";
  public static schema = notificationSchema;

  /**
   * Maps the in-app store's roles to your columns. This default is
   * single-tenant + read_at-only. Add tenant: "organization_id" for
   * multi-tenant; use isRead: "is_read" (instead of, or alongside, readAt) to
   * track a boolean read flag. The migration + accessors all follow this map.
   */
  public static columnMap: NotificationColumnMap = { readAt: "read_at" };
}
`;

export const notificationMigrationStub = `import { Migration } from "@warlock.js/cascade";
import { notificationColumns } from "@warlock.js/notifications";
import { Notification } from "../notification.model";

/**
 * Notifications table.
 *
 * Columns come from notificationColumns(Notification) — the recipient / tenant
 * / read-state names follow the model's columnMap; type / title / body /
 * payload / idempotency_key are fixed. Spread it to add your own columns
 * (remember to mirror them in the model schema):
 *
 *   import { uuid } from "@warlock.js/cascade";
 *
 *   export default Migration.create(Notification, {
 *     ...notificationColumns(Notification),
 *     // category_id: uuid().index().nullable(),
 *   });
 */
export default Migration.create(Notification, notificationColumns(Notification));
`;

export const notificationControllersStub = `import { type Request, type RequestHandler, type Response } from "@warlock.js/core";
import { inApp } from "@warlock.js/notifications";

/**
 * The authenticated user's notification HTTP surface — thin wrappers over the
 * recipient-scoped \`inApp\` facade (a foreign id can never touch another user's
 * rows). Notifications are produced by domain events, never over HTTP, so there
 * is no create. Trim or split these as your app grows.
 */

/** GET /notifications — list, most recent first (page / limit / type / unread via query). */
export const listNotificationsController: RequestHandler = async (
  request: Request,
  response: Response,
) => {
  const { data, pagination } = await inApp.list(request.user!, request.all());

  return response.success({ notifications: data, pagination });
};

listNotificationsController.description = "List notifications";

/** GET /notifications/unread-count — drives the bell badge. */
export const unreadNotificationsCountController: RequestHandler = async (
  request: Request,
  response: Response,
) => {
  const count = await inApp.countUnread(request.user!);

  return response.success({ count });
};

unreadNotificationsCountController.description = "Unread notifications count";

/** PATCH /notifications/:id/read — mark one read, return the updated row. */
export const markNotificationReadController: RequestHandler = async (
  request: Request,
  response: Response,
) => {
  const id = request.input("id");

  await inApp.markAsRead(request.user!, id);
  const notification = await inApp.find(request.user!, id);

  return response.success({ notification });
};

markNotificationReadController.description = "Mark notification read";

/** PATCH /notifications/read-all — mark every unread one read. */
export const markAllNotificationsReadController: RequestHandler = async (
  request: Request,
  response: Response,
) => {
  const count = await inApp.markAsRead(request.user!);

  return response.success({ count });
};

markAllNotificationsReadController.description = "Mark all notifications read";

/** DELETE /notifications — dismiss all for the user. */
export const clearNotificationsController: RequestHandler = async (
  request: Request,
  response: Response,
) => {
  await inApp.dismiss(request.user!);

  return response.noContent();
};

clearNotificationsController.description = "Clear notifications";

/** DELETE /notifications/:id — dismiss one. */
export const deleteNotificationController: RequestHandler = async (
  request: Request,
  response: Response,
) => {
  await inApp.dismiss(request.user!, request.input("id"));

  return response.noContent();
};

deleteNotificationController.description = "Delete notification";
`;

export const notificationRoutesStub = `import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";
import {
  clearNotificationsController,
  deleteNotificationController,
  listNotificationsController,
  markAllNotificationsReadController,
  markNotificationReadController,
  unreadNotificationsCountController,
} from "./controllers/notifications.controller";

/**
 * Notification routes — the authenticated user's read + dismiss surface.
 *
 * Notifications are produced by domain events (never created over HTTP), so
 * there is no POST. Every route is gated by \`authMiddleware\` and recipient-
 * scoped by \`inApp\` (a foreign id touches zero rows). Delete any endpoint you
 * don't need; if your app reads notifications over sockets/GraphQL instead,
 * delete this file + the controllers entirely.
 */
router.group({ prefix: "/notifications", middleware: [authMiddleware([])] }, () => {
  router.get("/", listNotificationsController);
  router.get("/unread-count", unreadNotificationsCountController);
  router.patch("/read-all", markAllNotificationsReadController);
  router.patch("/:id/read", markNotificationReadController);
  router.delete("/", clearNotificationsController);
  router.delete("/:id", deleteNotificationController);
});
`;

/**
 * `src/web/root.tsx` — the application root for the SSR page layer.
 *
 * Deliberately minimal. The framework ships a default root, so this exists to
 * give you a place to start rather than because anything requires it. The
 * reference app (`v5/app/src/web/root.tsx`) is where to look for the fuller
 * shape: middleware, an app-level loader, locales, an ErrorBoundary.
 */
export const webRootStub = `import { Head, Scripts } from "@warlock.js/web";
import type { AppProps } from "@warlock.js/web";

/**
 * The application root.
 *
 * NOT async, and it receives no request/response: it renders on the server and
 * again in the browser during hydration, where neither exists.
 */
export default function App({ children }: AppProps) {
  return (
    <html lang="en">
      <head>
        {/*
          Placement only. The framework injects the page's \`metadata\`, the
          stylesheet and preload tags for this route, and the canonical links
          into <head> by default — <Head /> just says WHERE they land.

          Do not add a <title> here: the page's \`metadata\` owns it, and a root
          that emits one too produces two.
        */}
        <Head />
        <link rel="icon" href="data:," />
      </head>
      <body>
        {/*
          REQUIRED — this is the hydration mount point, not a styling wrapper.

          The browser runtime looks up \`#root\` and hydrates that element only.
          Remove this div, or rename the id, and the page still renders from the
          server but never becomes interactive: the runtime throws in the console
          and nothing on screen changes.

          Wrap it in your own markup freely, and put anything that must live
          outside the hydrated tree (a static footer, a portal target) outside
          it — just keep an element with \`id="root"\` around {children}.
        */}
        <div id="root">{children}</div>
        {/*
          The hydration payload and module tags. Written explicitly because
          placement occasionally matters — a CSP nonce, or ordering against
          your own scripts.
        */}
        <Scripts />
      </body>
    </html>
  );
}
`;

/**
 * `src/app/contact/controllers/contact.controller.ts` — a real API endpoint
 * for the Web starter's contact form. It intentionally has no persistence
 * dependency: replace the acknowledgement with a mail/job/database action.
 */
export const webContactControllerStub = `import { type Request, type RequestHandler } from "@warlock.js/core";
import { type Infer, v } from "@warlock.js/seal";

export const contactSchema = v.object({
  name: v.string().min(2).required(),
  email: v.email().required(),
  message: v.string().min(10).required(),
});

export type ContactSchema = Infer.Output<typeof contactSchema>;

/** POST /api/contact — validates the starter contact form. */
export const contactController: RequestHandler<Request<ContactSchema>> = async ({ request, response }) => {
  const contact = request.validated();

  // Replace this with delivery/persistence for your app. Keeping the accepted
  // payload visible makes the endpoint useful while remaining side-effect free.
  return response.success({
    message: "Thanks, " + contact.name + ". Your message has been received.",
  });
};

contactController.validation = { schema: contactSchema };
`;

/** `src/app/contact/routes.ts` — discovered by the standard app route loader. */
export const webContactRoutesStub = `import { router } from "@warlock.js/core";
import { contactController } from "./controllers/contact.controller";

router.post("/api/contact", contactController);
`;

/**
 * `src/web/index.register.ts` — universal static setup for the starter page.
 *
 * The page re-exports this stable binding so Warlock's `register()` lifecycle
 * still sees it in both realms without making React Fast Refresh treat every
 * JSX edit as an incompatible function-export replacement.
 */
export const webHomeRegisterStub = `import { extend } from "@mongez/localization";

export function register() {
  extend("en", {
    starter: {
      title: "Your Warlock app is running.",
      introduction: "This page is rendered on the server and hydrated in the browser.",
      language: "العربية",
      contact: "Send a message",
      name: "Name",
      email: "Email",
      message: "Message",
      submit: "Send message",
      sent: "Thanks — your message has been received.",
    },
  });
  extend("ar", {
    starter: {
      title: "تطبيق Warlock يعمل الآن.",
      introduction: "تُعرض هذه الصفحة على الخادم ثم تُفعَّل في المتصفح.",
      language: "English",
      contact: "أرسل رسالة",
      name: "الاسم",
      email: "البريد الإلكتروني",
      message: "الرسالة",
      submit: "إرسال الرسالة",
      sent: "شكرًا — تم استلام رسالتك.",
    },
  });
}
`;

/**
 * `src/web/index.page.tsx` — one page, so \`warlock dev\` has something to serve
 * the moment this finishes.
 */
export const webHomePageStub = `import { http } from "@mongez/http";
import { Form, useFormControl, type FormControlProps } from "@mongez/react-form";
import { setCurrentLocaleCode } from "@mongez/localization";
import { transX } from "@mongez/react-localization";
import { v } from "@warlock.js/seal";
import { useState } from "react";
import { Link, type PageProps } from "@warlock.js/web";

export { register } from "./index.register";

/**
 * A page route is an ordinary Warlock route whose handler renders React
 * instead of returning JSON.
 *
 * The URL and stable hydration name are the ones this file DECLARES below.
 * This page answers \`GET "/"\` because \`route.path = "/"\`, not because of
 * where the file lives. A page file with
 * no \`route\` export is REFUSED by both the dev server and the build.
 */
export const route = { path: "/", name: "index" } as const;

export const metadata = { title: "Home" };

const contactSchema = v.object({
  name: v.string().min(2).required(),
  email: v.email().required(),
  message: v.string().min(10).required(),
});

function TextInput({ label, ...controlProps }: FormControlProps & { label: string }) {
  const { error, getErrorProps, getInputProps } = useFormControl(controlProps);

  return (
    <div className="wk-field">
      <label htmlFor={controlProps.name}>{label}</label>
      <input {...getInputProps()} />
      {error && <p {...getErrorProps()}>{error}</p>}
    </div>
  );
}

/**
 * Add a \`loader\` export to fetch data on the server, and it arrives here as
 * \`data\`, typed:
 *
 *   export const loader = (async () => ({ items: await itemsRepository.all() }));
 *   export default function HomePage({ data }: PageProps<typeof loader>) { ... }
 */
export default function HomePage(_props: PageProps) {
  // Live state. If the button below does nothing, the page rendered on the
  // server but never hydrated — the runtime never mounted at \`#root\`. This is
  // deliberately here so that failure is impossible to miss.
  const [count, setCount] = useState(0);
  const [locale, setLocale] = useState<"en" | "ar">("en");
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const toggleLocale = () => {
    const nextLocale = locale === "en" ? "ar" : "en";
    setCurrentLocaleCode(nextLocale);
    setLocale(nextLocale);
  };

  return (
    <>
      {/*
        Self-contained, dependency-free styling: plain CSS, system fonts, and
        CSS custom properties, scoped to this page. No CSS framework, no utility
        classes, no external stylesheet — this page looks the same whether or
        not \`warlock add tailwind\` has ever been run.
      */}
      <style>{\`
        .wk-home {
          --wk-fg: #0f172a;
          --wk-muted: #64748b;
          --wk-accent: #4f46e5;
          --wk-border: #e2e8f0;
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          color: var(--wk-fg);
          max-width: 42rem;
          margin: 4rem auto;
          padding: 0 1.5rem;
          line-height: 1.6;
        }
        .wk-home h1 { font-size: 2.25rem; margin: 0 0 0.5rem; }
        .wk-home p { color: var(--wk-muted); margin: 0 0 1.5rem; }
        .wk-home code {
          font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
          background: #f1f5f9;
          padding: 0.1rem 0.35rem;
          border-radius: 0.25rem;
        }
        .wk-check {
          border: 1px solid var(--wk-border);
          border-radius: 0.75rem;
          padding: 1.25rem 1.5rem;
          margin: 2rem 0;
        }
        .wk-check strong { display: block; font-size: 1.5rem; }
        .wk-check button {
          font: inherit;
          cursor: pointer;
          background: var(--wk-accent);
          color: #fff;
          border: 0;
          border-radius: 0.5rem;
          padding: 0.5rem 1rem;
          margin-top: 0.75rem;
        }
        .wk-links { display: flex; gap: 1.25rem; font-size: 0.95rem; }
        .wk-links a { color: var(--wk-accent); text-decoration: none; }
        .wk-links a:hover { text-decoration: underline; }
        .wk-language { margin-left: auto; }
        .wk-contact { margin-top: 2rem; }
        .wk-field { display: grid; gap: 0.35rem; margin: 0.8rem 0; }
        .wk-field input, .wk-field textarea { font: inherit; padding: 0.55rem; }
        .wk-field p, .wk-submit-error { color: #b91c1c; margin: 0; }
        .wk-success { color: #047857; }
      \`}</style>

      <main className="wk-home" dir={locale === "ar" ? "rtl" : "ltr"}>
        <nav className="wk-links" aria-label="Starter links">
          <a href="https://warlock.js.org" target="_blank" rel="noreferrer">Docs</a>
          <Link href="/" aria-current="page">Home</Link>
          <button
            className="wk-language"
            type="button"
            aria-pressed={locale === "ar"}
            onClick={toggleLocale}
          >
            {transX("starter.language")}
          </button>
        </nav>

        <h1>{transX("starter.title")}</h1>
        <p>{transX("starter.introduction")}</p>

        <section className="wk-check">
          <label>If this number goes up when you click, React is hydrated:</label>
          <strong>{count}</strong>
          <button type="button" onClick={() => setCount(c => c + 1)}>
            Count up
          </button>
        </section>

        <section className="wk-contact" aria-labelledby="contact-heading">
          <h2 id="contact-heading">{transX("starter.contact")}</h2>
          <Form<typeof contactSchema>
            id="contact-form"
            schema={contactSchema}
            onSubmit={async ({ form, values }) => {
              setSubmitted(false);
              setSubmitError(null);
              const result = await http.post<{ message: string }>("/api/contact", values);

              if (result.error) {
                if (result.error.isValidationError) {
                  const body = result.error.body as {
                    errors?: Array<{ input: string; error: string }>;
                    message?: string;
                  };
                  form.setErrors(
                    Object.fromEntries(
                      (body.errors ?? []).map(({ input, error }) => [input, error]),
                    ),
                  );
                  setSubmitError(body.message ?? "Please correct the highlighted fields.");
                } else {
                  setSubmitError("Your message could not be sent. Please try again.");
                }
                return;
              }

              setSubmitted(true);
              form.reset();
            }}
          >
            <TextInput name="name" label={transX("starter.name")} autoComplete="name" />
            <TextInput name="email" label={transX("starter.email")} type="email" autoComplete="email" />
            <ContactMessage />
            <button type="submit">{transX("starter.submit")}</button>
            {submitError && <p className="wk-submit-error" role="alert">{submitError}</p>}
            {submitted && <p className="wk-success" role="status">{transX("starter.sent")}</p>}
          </Form>
        </section>
      </main>
    </>
  );
}

function ContactMessage() {
  const { error, getErrorProps, getInputProps } = useFormControl({ name: "message" });

  return (
    <div className="wk-field">
      <label htmlFor="message">{transX("starter.message")}</label>
      <textarea {...getInputProps()} rows={5} />
      {error && <p {...getErrorProps()}>{error}</p>}
    </div>
  );
}
`;
