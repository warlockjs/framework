import { context } from "esbuild";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

function request(
  port: number,
  requestPath: string,
): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    // URL/fetch would normalize backslashes before the server receives them.
    const clientRequest = get({ host: "127.0.0.1", port, path: requestPath }, (response) => {
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode, body }));
      response.on("error", reject);
    });
    clientRequest.setTimeout(5_000, () =>
      clientRequest.destroy(new Error("HTTP request timed out")),
    );
    clientRequest.on("error", reject);
  });
}

// https://github.com/advisories/GHSA-g7r4-m6w7-qqqr: esbuild >=0.28.1
// rejects backslashes on every OS, before Windows can interpret them as separators.
it("serves public files while rejecting raw and encoded backslash traversal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "warlock-esbuild-serve-"));
  const publicDir = path.join(root, "public");

  try {
    await mkdir(publicDir);
    await writeFile(path.join(publicDir, "hello.txt"), "public file");
    await writeFile(path.join(root, "secret.txt"), "outside serve directory");
    const build = await context({
      stdin: { contents: "export const ready = true;", resolveDir: root },
      outfile: path.join(publicDir, "app.js"),
      write: false,
      logLevel: "silent",
    });

    try {
      const { port } = await build.serve({ host: "127.0.0.1", port: 0, servedir: publicDir });
      expect(await request(port, "/hello.txt")).toEqual({ status: 200, body: "public file" });

      for (const requestPath of ["/..\\secret.txt", "/..%5csecret.txt"]) {
        const response = await request(port, requestPath);
        expect(response.status).toBe(400);
        expect(response.body).not.toContain("outside serve directory");
      }
    } finally {
      await build.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
