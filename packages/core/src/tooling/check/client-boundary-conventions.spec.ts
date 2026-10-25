import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isClientModule, isServerOnlyFile } from "./client-boundary-conventions";
import { checkFileConventions } from "./conventions-step";

let root: string;

function write(relative: string, source = "export const value = 1;\n"): void {
  const file = path.join(root, relative);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}

function wl9021(file: string, source: string) {
  return checkFileConventions(file, source, root).filter((problem) => problem.code === "WL9021");
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-client-boundary-"));
  write("src/app/users/format.client.ts");
  write("src/app/users/utils/date-label.ts", 'import { format } from "../format.client";\n');
  write("src/app/users/utils/plain.ts");
  write("src/web/users/widget.client.tsx");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("isClientModule / isServerOnlyFile", () => {
  it("names .client modules by suffix and by folder", () => {
    expect(isClientModule("src/app/users/format.client.ts")).toBe(true);
    expect(isClientModule("src/web/users/widget.client.tsx")).toBe(true);
    expect(isClientModule("src/web/.client/widget.ts")).toBe(true);
    expect(isClientModule("src/app/users/clients.ts")).toBe(false);
  });

  it("names the server-only files", () => {
    for (const file of [
      "src/app/users/controllers/list-users.controller.ts",
      "src/app/users/services/create-user.service.ts",
      "src/app/users/repositories/users.repository.ts",
      "src/app/users/models/user/user.model.ts",
      "src/app/users/routes.ts",
      "src/app/users/main.ts",
      "src/app/users/events/user-created.ts",
      "src/app/users/utils/mail.server.ts",
      "src/app/main.ts",
      "src/connectors/queue.connector.ts",
    ]) {
      expect(isServerOnlyFile(file), file).toBe(true);
    }
  });

  it("leaves universal, web, client and test files alone", () => {
    for (const file of [
      "src/app/users/utils/plain.ts",
      "src/app/users/schema/create-user.schema.ts",
      "src/app/users/format.client.ts",
      "src/web/users/page.page.tsx",
      "src/app/users/services/create-user.service.spec.ts",
    ]) {
      expect(isServerOnlyFile(file), file).toBe(false);
    }
  });
});

describe("WL9021 server-only code imports a .client module", () => {
  it("reports a direct import from a service, with its position and chain", () => {
    const problems = wl9021(
      "src/app/users/services/create-user.service.ts",
      'import { format } from "../format.client";\nexport const x = format;\n',
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ severity: "error", line: 1 });
    expect(problems[0]?.message).toContain(
      "src/app/users/services/create-user.service.ts -> src/app/users/format.client.ts",
    );
  });

  it("covers the app alias and the other server-only kinds", () => {
    const source = 'import { format } from "app/users/format.client";\n';

    for (const file of [
      "src/app/users/controllers/list-users.controller.ts",
      "src/app/users/repositories/users.repository.ts",
      "src/app/users/models/user/user.model.ts",
      "src/app/users/routes.ts",
      "src/app/users/utils/mail.server.ts",
    ]) {
      expect(wl9021(file, source), file).toHaveLength(1);
    }
  });

  it("follows value imports through files that are not server-only and names every hop", () => {
    const problems = wl9021(
      "src/app/users/services/create-user.service.ts",
      'import { label } from "../utils/date-label";\n',
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(
      "src/app/users/services/create-user.service.ts -> src/app/users/utils/date-label.ts -> src/app/users/format.client.ts",
    );
  });

  it("ignores type-only imports and unrelated imports", () => {
    expect(
      wl9021(
        "src/app/users/services/create-user.service.ts",
        'import type { Format } from "../format.client";\nimport { plain } from "../utils/plain";\n',
      ),
    ).toEqual([]);
  });

  it("does not report pages, components, client modules or tests", () => {
    const source = 'import { widget } from "web/users/widget.client";\n';

    expect(wl9021("src/web/users/page.page.tsx", source)).toEqual([]);
    expect(wl9021("src/web/users/components/card.tsx", source)).toEqual([]);
    expect(wl9021("src/web/users/other.client.tsx", source)).toEqual([]);
    expect(
      wl9021(
        "src/app/users/services/create-user.service.spec.ts",
        'import { format } from "../format.client";\n',
      ),
    ).toEqual([]);
  });

  it("leaves another server-only file to its own report", () => {
    write(
      "src/app/users/services/helper.service.ts",
      'import { format } from "../format.client";\n',
    );

    expect(
      wl9021(
        "src/app/users/controllers/list-users.controller.ts",
        'import { helper } from "../services/helper.service";\n',
      ),
    ).toEqual([]);
  });

  it("can be silenced like every convention", () => {
    const problems = checkFileConventions(
      "src/app/users/services/create-user.service.ts",
      '// warlock-check-ignore WL9021\nimport { format } from "../format.client";\n',
      root,
    );

    expect(problems.filter((problem) => problem.code === "WL9021")).toEqual([]);
  });
});
