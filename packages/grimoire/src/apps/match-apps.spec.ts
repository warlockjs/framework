import { describe, expect, it } from "vitest";
import type { WrittenApp } from "../contracts/written";
import { matchApps } from "./match-apps";

const at = { file: "grimoire/apps/x/README.md", line: 1, column: null };

function app(id: string, type: "site" | "mobile", root: string): WrittenApp {
  return {
    dir: `grimoire/apps/${id}`,
    file: `grimoire/apps/${id}/README.md`,
    id: { value: id, at },
    type: { value: type, at },
    root: { value: root, at },
    heading: null,
    conditions: [],
    layouts: [],
    pages: [],
    screens: [],
  };
}

describe("matchApps", () => {
  it("matches sites and mobile apps by root, with either separator", () => {
    const client = { id: "client", root: "src/web/$sites/client", basePath: null };
    const mobile = { id: "mobile", root: "mobile", routing: "files" as const, routesDir: "mobile/app", screens: [] };

    expect(
      matchApps(
        [
          app("web-client", "site", "src\\web\\$sites\\client\\"),
          app("phone", "mobile", "./mobile"),
          app("web-admin", "site", "src/web/$sites/admin"),
          app("wrong", "mobile", "src/web/$sites/client"),
        ],
        { sites: [client], mobile: [mobile] },
      ),
    ).toEqual({
      "web-client": { app: "web-client", type: "site", site: client, mobile: null },
      phone: { app: "phone", type: "mobile", site: null, mobile },
      "web-admin": { app: "web-admin", type: "site", site: null, mobile: null },
      wrong: { app: "wrong", type: "mobile", site: null, mobile: null },
    });
  });
});
