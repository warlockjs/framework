import { describe, expect, it } from "vitest";
import { barrelFindings } from "./barrel-conventions";
import { checkFileConventions } from "./conventions-step";
import * as ast from "../syntax/ast";

const BARREL =
  'export * from "./create-user.service";\nexport { updateUser } from "./update-user.service";\n';

function findings(file: string, source: string) {
  return barrelFindings(ast.parseSourceFile(file, source));
}

describe("WL9023 hand-maintained barrel", () => {
  it("reports an index.ts that only re-exports, at any depth of an app module", () => {
    for (const file of [
      "src/app/users/services/index.ts",
      "src/app/users/models/user/index.ts",
      "src/app/users/index.ts",
    ]) {
      expect(findings(file, BARREL), file).toHaveLength(1);
    }
  });

  it("leaves an index.ts that holds code, a generated header and other folders alone", () => {
    expect(
      findings("src/app/users/utils/index.ts", 'export * from "./a";\nexport const x = 1;\n'),
    ).toEqual([]);
    expect(
      findings("src/app/users/utils/index.ts", `// Auto-generated. Do not edit.\n${BARREL}`),
    ).toEqual([]);
    expect(findings("src/app/users/utils/index.ts", "")).toEqual([]);
    expect(findings("src/web/users/index.ts", BARREL)).toEqual([]);
    expect(findings("src/app/users/services/create-user.service.ts", BARREL)).toEqual([]);
  });

  it("is off by default and on once the rule names a severity", () => {
    const file = "src/app/users/services/index.ts";
    const codes = (rules?: { WL9023: "off" | "warning" | "error" }) =>
      checkFileConventions(file, BARREL, process.cwd(), rules ? { rules } : {}).map(
        (problem) => problem.code,
      );

    expect(codes()).toEqual([]);
    expect(codes({ WL9023: "off" })).toEqual([]);
    expect(codes({ WL9023: "warning" })).toEqual(["WL9023"]);

    const [problem] = checkFileConventions(file, BARREL, process.cwd(), {
      rules: { WL9023: "error" },
    });

    expect(problem).toMatchObject({ code: "WL9023", severity: "error", line: 1 });
  });
});
