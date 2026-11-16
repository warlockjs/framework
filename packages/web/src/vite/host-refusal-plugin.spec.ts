import { createServer as createHttpServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { hostRefusalMessage, hostRefusalPlugin } from "./host-refusal-plugin";

let vite: ViteDevServer | undefined;
let http: Server | undefined;

afterEach(async () => {
  http?.close();
  await vite?.close();
  vite = undefined;
  http = undefined;
});

async function get(hostHeader: string): Promise<{ status: number; body: string }> {
  vite = await createServer({
    configFile: false,
    logLevel: "silent",
    root: process.cwd(),
    plugins: [hostRefusalPlugin()],
    server: { middlewareMode: true, allowedHosts: ["allowed.test"] },
  });
  const middlewares = vite.middlewares;

  http = createHttpServer(middlewares);
  await new Promise<void>((resolve) => http!.listen(0, "127.0.0.1", resolve));

  const { port } = http.address() as AddressInfo;

  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port, path: "/", headers: { host: hostHeader } },
      (response) => {
        let body = "";

        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );

    outgoing.on("error", reject);
    outgoing.end();
  });
}

describe("hostRefusalPlugin", () => {
  it("names web.devAllowedHosts in the refusal of an unknown host", async () => {
    const { status, body } = await get("other.test");

    expect(status).toBe(403);
    expect(body).toBe(hostRefusalMessage('"other.test"'));
    expect(body).toContain("web.devAllowedHosts");
    expect(body).not.toContain("vite.config");
  });

  it("does not refuse an allowed host", async () => {
    const { body } = await get("allowed.test");

    expect(body).not.toContain("Blocked request");
  });
});
