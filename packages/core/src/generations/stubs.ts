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

export const communicatorsConfigStub = `import { env } from "@mongez/dotenv";
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
