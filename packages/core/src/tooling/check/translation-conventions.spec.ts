import { describe, expect, it } from "vitest";
import { translationProblems } from "./translation-conventions";

describe("translationProblems (WL9104)", () => {
  it("reports a computed key in a client file with its position", () => {
    const problems = translationProblems(
      "src/web/orders/page.tsx",
      "export default function Page({ status }) {\n  return <p>{trans(status)}</p>;\n}\n",
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      code: "WL9104",
      file: "src/web/orders/page.tsx",
      line: 2,
      severity: "warning",
    });
    expect(problems[0]?.message).toContain("config.translations");
  });

  it("is silent for literal and static-prefix keys", () => {
    expect(
      translationProblems(
        "src/web/orders/page.tsx",
        'export default () => <p>{trans("orders.title")} {trans(`statuses.${s}`)}</p>;',
      ),
    ).toEqual([]);
  });

  it("is silent outside src/web and for setup files", () => {
    expect(translationProblems("src/app/orders/service.ts", "trans(key);")).toEqual([]);
    expect(translationProblems("src/web/orders/page.setup.ts", "trans(key);")).toEqual([]);
  });
});
