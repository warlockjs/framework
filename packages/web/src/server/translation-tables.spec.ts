import { beforeEach, describe, expect, it } from "vitest";
import { contentHash } from "../translations/delivery";
import { registerTranslationTableRoute } from "./translation-route";
import {
  publishTranslationTable,
  RECENT_TRANSLATION_TABLES,
  resetTranslationTablesForTests,
  translationTableFor,
  translationTableUrl,
} from "./translation-tables";

type Handler = (context: {
  request: { params: Record<string, string> };
  response: {
    header(name: string, value: string): unknown;
    send(body: string, status?: number): unknown;
  };
}) => Promise<unknown>;

/** Capture the handler the route registers, and drive it with a request for one file name. */
function serve(file: string): {
  status: number | undefined;
  headers: Record<string, string>;
  body: string;
} {
  let handler: Handler | undefined;
  registerTranslationTableRoute({
    get(path: string, value: unknown) {
      expect(path).toBe("/__warlock/translations/*");
      handler = value as Handler;
    },
  } as never);

  const headers: Record<string, string> = {};
  const sent = { status: undefined as number | undefined, body: "" };

  void handler?.({
    request: { params: { "*": file } },
    response: {
      header(name: string, value: string) {
        headers[name] = value;
      },
      send(body: string, status?: number) {
        sent.body = body;
        sent.status = status;
      },
    },
  });

  return { status: sent.status, headers, body: sent.body };
}

beforeEach(() => {
  resetTranslationTablesForTests();
});

describe("publishTranslationTable", () => {
  it("names a table by the hash of its exact bytes, and the same bytes give the same name", () => {
    const body = '{"app":{"title":"Orders"}}';

    expect(publishTranslationTable("en", body, false)).toBe(contentHash(body));
    expect(publishTranslationTable("en", body, false)).toBe(contentHash(body));
    expect(translationTableUrl("en", contentHash(body))).toBe(
      `/__warlock/translations/en.${contentHash(body)}.json`,
    );
  });

  it("keeps only the most recent tables per locale", () => {
    const hashes: string[] = [];

    for (let version = 0; version <= RECENT_TRANSLATION_TABLES; version += 1) {
      hashes.push(publishTranslationTable("en", `{"v":${version}}`, false));
    }

    expect(translationTableFor("en", hashes[0] ?? "")).toBeUndefined();
    expect(translationTableFor("en", hashes.at(-1) ?? "")).toBeDefined();
  });

  it("keeps locales apart", () => {
    const hash = publishTranslationTable("en", '{"a":1}', false);

    expect(translationTableFor("ar", hash)).toBeUndefined();
  });
});

describe("the translation table route", () => {
  it("serves a published table as an immutable, cacheable JSON body", () => {
    const body = '{"app":{"title":"Orders"}}';
    const hash = publishTranslationTable("en", body, false);

    const response = serve(`en.${hash}.json`);

    expect(response.status).toBeUndefined();
    expect(response.body).toBe(body);
    expect(response.headers["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(response.headers["Content-Type"]).toBe("application/json; charset=utf-8");
  });

  it("answers a development table with no-store, so the browser reads the server's current copy", () => {
    const hash = publishTranslationTable("en", '{"members":{"title":"Members"}}', true);

    expect(serve(`en.${hash}.json`).headers["Cache-Control"]).toBe("no-store");
  });

  it("answers a stale or unknown hash with 404 and no-store, never a different body under the same name", () => {
    const stale = publishTranslationTable("en", '{"a":1}', false);
    for (let version = 0; version < RECENT_TRANSLATION_TABLES; version += 1) {
      publishTranslationTable("en", `{"v":${version}}`, false);
    }

    const response = serve(`en.${stale}.json`);

    expect(response.status).toBe(404);
    expect(response.body).toBe("");
    expect(response.headers["Cache-Control"]).toBe("no-store");
  });

  it("refuses a name that is not a table file", () => {
    expect(serve("../secrets.json").status).toBe(404);
    expect(serve("en.json").status).toBe(404);
  });
});
