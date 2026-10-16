import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as vitest from "vitest";
import { authMiddleware, authService, type Auth } from "@warlock.js/auth";
import { BaseNotificationsRepository, inApp } from "@warlock.js/notifications";
import type { Id } from "@warlock.js/notifications";
import * as core from "../../../src";
import { config, setConfig } from "../../../src/config";
import { actingAs } from "../../../src/tests/authenticated-test-client";
import { expectJson, testGet, testPatch } from "../../../src/tests/test-helpers";
import * as stubs from "../../../src/generations/stubs";
import { bootHarness, type HttpHarness } from "../../integration/http/harness";
import { randomUUID } from "node:crypto";
import { v } from "@warlock.js/seal";

/** Execute the exact emitted specs/controllers; only the external DB boundary is in memory. */
function evaluate<T>(source: string, dependencies: Record<string, unknown>): T {
  const module = { exports: {} };
  const compiled = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  new Function("module", "exports", "require", compiled)(module, module.exports, (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected generated import: ${name}`);
    return dependencies[name];
  });
  return module.exports as T;
}

type Row = { id: number; user_id: Id; type: string; title: string; read_at?: Date | null };
const users = new Map<Id, FixtureUser>();
const rows = new Map<Id, FixtureNotification>();
const tokens = new Map<string, FixtureToken>();
let nextId = 0;

class FixtureUser {
  public readonly id = ++nextId;
  public readonly userType = "user";
  public static async create() {
    const user = new FixtureUser();
    users.set(user.id, user);
    return user;
  }
  public static async find(id: Id) {
    return users.get(id) ?? null;
  }
  public generateAccessToken() {
    return authService.generateAccessToken(this as unknown as Auth);
  }
  public removeAccessToken(token: string) {
    return authService.removeAccessToken(this as unknown as Auth, token);
  }
  public async destroy() {
    users.delete(this.id);
  }
}
class FixtureToken {
  public readonly isExpired = false;
  public readonly userType = "user";
  public constructor(
    public readonly token: string,
    public readonly userId: Id,
  ) {}
  public static async issue(user: FixtureUser, token: string) {
    tokens.set(token, new FixtureToken(token, user.id));
  }
  public static async findByToken(token: string) {
    return tokens.get(token) ?? null;
  }
  public static async deleteForUser(user: FixtureUser, token: string) {
    if (tokens.get(token)?.userId === user.id) tokens.delete(token);
  }
  public async destroy() {
    tokens.delete(this.token);
  }
}
class FixtureNotification {
  public constructor(public readonly data: Row) {}
  public get id() {
    return this.data.id;
  }
  public get recipientId() {
    return this.data.user_id;
  }
  public get type() {
    return this.data.type;
  }
  public get readAt() {
    return this.data.read_at ?? null;
  }
  public async markRead() {
    this.data.read_at = new Date();
  }
  public get isRead() {
    return this.data.read_at != null;
  }
  public static events() {
    return new Proxy({}, { get: () => () => () => undefined });
  }
  public static async create(data: Omit<Row, "id">) {
    const row = new FixtureNotification({ ...data, id: ++nextId });
    rows.set(row.id, row);
    return row;
  }
  public static async find(id: Id) {
    return rows.get(id) ?? null;
  }
  public async destroy() {
    rows.delete(this.id);
  }
  public toJSON() {
    return {
      id: this.id,
      title: this.data.title,
      readAt: this.data.read_at?.toISOString() ?? null,
    };
  }
}

function matching(options: { recipientId?: Id; unread?: boolean; id?: Id } = {}) {
  return [...rows.values()].filter(
    (row) =>
      (options.recipientId === undefined || row.data.user_id === options.recipientId) &&
      (options.id === undefined || row.id === options.id) &&
      (!options.unread || !row.isRead),
  );
}

const common = { "@warlock.js/core": core, "@warlock.js/notifications": { inApp } };
const schema = evaluate<object>(stubs.listNotificationsSchemaStub, { "@warlock.js/seal": { v } });
const service = evaluate<object>(stubs.markNotificationReadServiceStub, common);
const controllers = [
  ["listNotificationsController", stubs.listNotificationsControllerStub],
  ["unreadNotificationsCountController", stubs.unreadNotificationsCountControllerStub],
  ["markNotificationReadController", stubs.markNotificationReadControllerStub],
  ["markAllNotificationsReadController", stubs.markAllNotificationsReadControllerStub],
] as const;
const resolved = controllers.map(([name, source]) =>
  evaluate<Record<string, unknown>>(source, {
    ...common,
    "../schema/list-notifications.schema": schema,
    "../services/mark-notification-read.service": service,
  }),
);
let harness: HttpHarness | undefined;
let originalAuth: unknown;

beforeEach(async () => {
  originalAuth = config.get("auth");
  setConfig("auth", {
    userType: { user: FixtureUser },
    accessToken: { secret: "notification-spec-signing-key", expiresIn: "1h", model: FixtureToken },
  });
  const repository = new BaseNotificationsRepository(
    FixtureNotification as unknown as ConstructorParameters<typeof BaseNotificationsRepository>[0],
  );
  vitest.vi
    .spyOn(repository, "list")
    .mockImplementation(
      async (options) =>
        ({ data: matching(options).slice(0, options?.limit ?? 20), pagination: {} }) as never,
    );
  vitest.vi
    .spyOn(repository, "countCached")
    .mockImplementation(async (options) => matching(options).length);
  vitest.vi
    .spyOn(repository, "first")
    .mockImplementation(async (options) => matching(options)[0] ?? null);
  vitest.vi.spyOn(repository, "updateMany").mockImplementation(async (filter, update) => {
    let count = 0;
    for (const row of rows.values()) {
      if (
        Object.entries(filter).every(
          ([key, value]) => (row.data[key as keyof Row] ?? null) === value,
        )
      ) {
        Object.assign(row.data, update);
        count++;
      }
    }
    return count;
  });
  inApp.configure({ repository });
  harness = await bootHarness((router) => {
    const dependencies: Record<string, unknown> = {
      "@warlock.js/auth": { authMiddleware },
      "@warlock.js/core": { router },
    };
    for (const [index, [name]] of controllers.entries()) {
      const file = [
        "list-notifications",
        "unread-notifications-count",
        "mark-notification-read",
        "mark-all-notifications-read",
      ][index];
      dependencies[`./controllers/${file}.controller`] = { [name]: resolved[index][name] };
    }
    evaluate(stubs.notificationRoutesStub, dependencies);
  });
  vitest.vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const headers = Object.fromEntries(new Headers(init.headers));
    const result = await harness!.inject({
      method: (init.method ?? "GET") as "GET" | "PATCH",
      url: url.pathname + url.search,
      headers,
    });
    return new Response(result.body, {
      status: result.statusCode,
      headers: Object.fromEntries(
        Object.entries(result.headers).map(([key, value]) => [key, String(value)]),
      ),
    });
  });
});
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  setConfig("auth", originalAuth);
  rows.clear();
  users.clear();
  tokens.clear();
  vitest.vi.restoreAllMocks();
  vitest.vi.unstubAllGlobals();
});

const fixture = evaluate<object>(stubs.notificationTestFixtureStub, {
  "@warlock.js/core": { config },
  "@warlock.js/core/tests": { actingAs },
  "node:crypto": { randomUUID },
  "../models/notification/notification.model": { Notification: FixtureNotification },
});
for (const [method, path] of [
  ["GET", "/notifications"],
  ["GET", "/notifications/unread-count"],
  ["PATCH", "/notifications/1/read"],
  ["PATCH", "/notifications/read-all"],
] as const) {
  evaluate(stubs.notificationControllerSpecStub(method, path), {
    "@warlock.js/core/tests": { testGet, testPatch, expectJson },
    vitest: { afterEach, beforeEach, describe, expect, it },
    "../models/notification/notification.model": { Notification: FixtureNotification },
    "../tests/notifications.fixture": fixture,
  });
}
