import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, HOST, PATH, type TestApp } from "./harness";

const PING_MS = 15_000;

type OpenStream = {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Everything received so far. */
  text(): string;
  ended: Promise<void>;
  close(): void;
};

const apps: TestApp[] = [];
const opened: OpenStream[] = [];

afterEach(async () => {
  vi.useRealTimers();

  for (const stream of opened.splice(0)) stream.close();
  for (const t of apps.splice(0)) await t.app.close();
});

async function start(
  config: Parameters<typeof createApp>[0] = {},
): Promise<{ t: TestApp; port: number }> {
  const t = await createApp(config);

  apps.push(t);
  await t.app.listen({ port: 0, host: "127.0.0.1" });

  const address = t.app.server.address();

  if (address === null || typeof address === "string") throw new Error("expected a bound port");

  return { t, port: address.port };
}

/** Opens the stream like the dashboard does: over the loopback socket with the proxy headers. */
function open(port: number, session: { token: string } | null): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port,
        path: `${PATH}/api/stream`,
        headers: {
          host: HOST,
          "x-forwarded-proto": "https",
          "x-forwarded-for": "203.0.113.5",
          ...(session ? { cookie: `__Secure-warlock-devtools=${session.token}` } : {}),
        },
      },
      (response) => {
        let received = "";
        const ended = new Promise<void>((done) => {
          response.on("end", done);
          response.on("close", done);
        });

        response.on("data", (chunk) => {
          received += chunk.toString();
        });

        const stream: OpenStream = {
          status: response.statusCode ?? 0,
          headers: response.headers,
          text: () => received,
          ended,
          close: () => request.destroy(),
        };

        opened.push(stream);
        resolve(stream);
      },
    );

    request.on("error", reject);
  });
}

describe("the production stream", () => {
  it("starts with retry and hello, and carries the dashboard headers without CORS", async () => {
    const { t, port } = await start({ cors: true });
    const session = await t.signIn("admin@example.com", "admin");
    const stream = await open(port, session);

    await vi.waitFor(() => expect(stream.text()).toContain("event: hello"));

    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toBe("text/event-stream");
    expect(stream.headers["cache-control"]).toBe("no-store");
    expect(stream.headers["x-accel-buffering"]).toBe("no");
    expect(stream.headers["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
    expect(stream.headers["x-content-type-options"]).toBe("nosniff");
    expect(Object.keys(stream.headers).some((name) => name.startsWith("access-control-"))).toBe(
      false,
    );
    expect(stream.text()).toBe(
      `retry: 5000\n\nevent: hello\ndata: ${JSON.stringify({ mode: "production", instance: "host:1:abc", role: "admin" })}\n\n`,
    );
  });

  it("answers the uniform 404 without a session", async () => {
    const { port } = await start({ notFound: "custom" });
    const stream = await open(port, null);

    expect(stream.status).toBe(404);
    expect(stream.headers["x-accel-buffering"]).toBeUndefined();
  });

  it("forwards request events with the instance, and log events without context", async () => {
    const { t, port } = await start();
    const session = await t.signIn("viewer@example.com");
    const stream = await open(port, session);

    await vi.waitFor(() => expect(t.collector.listenerCount()).toBe(1));

    t.collector.emit({
      type: "request",
      data: { id: "r1", method: "GET", path: "/x", startedAt: 1, queryCount: 0, warningCount: 0 },
    });
    t.collector.emit({
      type: "log",
      data: { level: "info", module: "m", action: "a", message: "dropped", at: 1 },
    });
    t.collector.emit({
      type: "log",
      data: {
        level: "error",
        module: "m",
        action: "a",
        message: "kept",
        at: 2,
        context: { password: "s3cret" },
      },
    });
    t.collector.emit({
      type: "mail",
      data: { id: "m1", capturedAt: 1, to: [], subject: "dropped" },
    });

    await vi.waitFor(() => expect(stream.text()).toContain("kept"));

    const text = stream.text();

    expect(text).toContain(
      `event: request\ndata: ${JSON.stringify({ id: "r1", method: "GET", path: "/x", startedAt: 1, queryCount: 0, warningCount: 0, instance: "host:1:abc" })}`,
    );
    expect(text).toContain(
      `event: log\ndata: ${JSON.stringify({ level: "error", module: "m", action: "a", message: "kept", at: 2, instance: "host:1:abc" })}`,
    );
    expect(text).not.toContain("dropped");
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("event: mail");
  });

  it("forwards mail events when the Mail tab is on", async () => {
    const { t, port } = await start({ builtInPanels: ["requests", "mail"] });
    const session = await t.signIn("viewer@example.com");
    const stream = await open(port, session);

    await vi.waitFor(() => expect(t.collector.listenerCount()).toBe(1));
    t.collector.emit({
      type: "mail",
      data: { id: "m1", capturedAt: 1, to: [], subject: "welcome" },
    });

    await vi.waitFor(() => expect(stream.text()).toContain("event: mail"));
  });

  it("sends a ping every 15 seconds while the session stays valid", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });

    const { t, port } = await start();
    const session = await t.signIn("viewer@example.com");
    const stream = await open(port, session);

    await vi.waitFor(() => expect(stream.text()).toContain("event: hello"));
    await vi.advanceTimersByTimeAsync(PING_MS);
    await vi.waitFor(() => expect(stream.text()).toContain(": ping"));
  });

  it("ends when the session is revoked", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });

    const { t, port } = await start();
    const session = await t.signIn("viewer@example.com");
    const stream = await open(port, session);

    await vi.waitFor(() => expect(stream.text()).toContain("event: hello"));
    expect((await t.send("POST", "/api/auth/logout", { session })).statusCode).toBe(204);

    await vi.advanceTimersByTimeAsync(PING_MS);
    await stream.ended;

    expect(stream.text()).not.toContain(": ping");
    expect(t.collector.listenerCount()).toBe(0);
  });

  it("ends when the account is signed out by an admin", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });

    const { t, port } = await start();
    const admin = await t.signIn("admin@example.com", "admin");
    const viewer = await t.signIn("viewer@example.com");
    const stream = await open(port, viewer);

    await vi.waitFor(() => expect(stream.text()).toContain("event: hello"));
    expect(
      (await t.send("POST", `/api/admin/users/${viewer.accountId}/sign-out`, { session: admin }))
        .statusCode,
    ).toBe(204);

    await vi.advanceTimersByTimeAsync(PING_MS);
    await stream.ended;
    expect(t.collector.listenerCount()).toBe(0);
  });

  it("ends when the dashboard is disabled", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });

    const { t, port } = await start();
    const admin = await t.signIn("admin@example.com", "admin");
    const stream = await open(port, admin);

    await vi.waitFor(() => expect(stream.text()).toContain("event: hello"));
    await t.send("POST", "/api/admin/disable", { session: admin, body: { confirm: "disable" } });

    await vi.advanceTimersByTimeAsync(PING_MS);
    await stream.ended;
    expect(t.collector.listenerCount()).toBe(0);
  });

  it("ends when the session has been idle too long, and does not keep it alive itself", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });

    const { t, port } = await start({ production: { session: { idleMinutes: 1 } } });
    const session = await t.signIn("viewer@example.com");
    const before = (await t.store.sessions.listForAccount(session.accountId))[0]?.lastSeenAt;
    const stream = await open(port, session);

    await vi.waitFor(() => expect(stream.text()).toContain("event: hello"));

    // Pings at 15 s, 30 s and 45 s are fine; the one at 60 s finds the session idle.
    await vi.advanceTimersByTimeAsync(PING_MS * 3);
    await vi.waitFor(() => expect(stream.text().match(/: ping/g)?.length).toBe(3));
    expect((await t.store.sessions.listForAccount(session.accountId))[0]?.lastSeenAt).toBe(before);

    await vi.advanceTimersByTimeAsync(PING_MS);
    await stream.ended;
  });

  it("allows three streams per session and refuses the fourth, then frees a slot on close", async () => {
    const { t, port } = await start();
    const session = await t.signIn("viewer@example.com");
    const streams = [
      await open(port, session),
      await open(port, session),
      await open(port, session),
    ];

    for (const stream of streams) expect(stream.status).toBe(200);

    await vi.waitFor(() => expect(t.collector.listenerCount()).toBe(3));

    const refused = await open(port, session);

    expect(refused.status).toBe(429);
    await vi.waitFor(() => expect(refused.text()).toContain("stream.too-many"));
    expect(JSON.parse(refused.text())).toMatchObject({ code: "stream.too-many" });

    streams[0]?.close();
    await vi.waitFor(() => expect(t.collector.listenerCount()).toBe(2));

    const again = await open(port, session);

    expect(again.status).toBe(200);
  });

  it("serves at most 50 streams per instance", async () => {
    const { t, port } = await start();
    const sessions = [];

    for (let index = 0; index < 17; index += 1) {
      sessions.push(await t.signIn(`viewer${index}@example.com`));
    }

    let accepted = 0;
    let refused = 0;

    for (const session of sessions) {
      for (let slot = 0; slot < 3; slot += 1) {
        const stream = await open(port, session);

        if (stream.status === 200) accepted += 1;
        else refused += 1;
      }
    }

    expect(accepted).toBe(50);
    expect(refused).toBe(1);
  });
});
