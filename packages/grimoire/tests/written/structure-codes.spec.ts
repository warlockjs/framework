/**
 * One case per structure code (GR1001 to GR1028): a copy of the `shop`
 * fixture with one file broken gives that code at the right file and line,
 * with the right subject; the base fixture gives none of it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GRIMOIRE_CODE_LIST, explainGrimoireCode } from "../../src/codes";
import type { GrimoireFinding } from "../../src/contracts/findings";
import { parseGrimoire } from "../../src/written";
import { shopRoot } from "../fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../support/copy-fixture";

type Case = {
  code: string;
  /** What is broken, for the test name. */
  name: string;
  /** Break the copy. */
  breakIt: (copy: FixtureCopy) => void;
  /** The project-relative file the finding points at. */
  file: string;
  /** The line, or a text whose (first) line in the broken file is the finding's line. */
  line: number | string;
  subject?: Partial<GrimoireFinding["subject"]>;
};

const LOGIN = "grimoire/features/auth/flows/login.md";
const SIGN_UP = "grimoire/features/auth/flows/sign-up.md";
const BROWSE = "grimoire/features/catalog/flows/browse-products.md";
const NEW_ARRIVALS = "grimoire/features/catalog/flows/new-arrivals.md";
const PLACE_ORDER = "grimoire/features/orders/flows/place-order.md";
const CATALOG_README = "grimoire/features/catalog/README.md";
const AUTH_CHANGELOG = "grimoire/features/auth/CHANGELOG.md";
const LOGIN_SUBJECT = { feature: "auth", flow: "auth/login" };

function create(copy: FixtureCopy, file: string, content: string | Uint8Array): void {
  const absolute = path.join(copy.root, ...file.split("/"));

  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

const TASK = (id: string): string =>
  `---\nid: ${id}\ntype: chore\nstatus: open\n---\n\n# Something to do\n`;

const CASES: Case[] = [
  {
    code: "GR1001",
    name: "a flow without front matter",
    breakIt: (copy) => copy.write(LOGIN, copy.read(LOGIN).replace(/^---\n[\s\S]*?\n---\n/, "")),
    file: LOGIN,
    line: 1,
    subject: LOGIN_SUBJECT,
  },
  {
    code: "GR1002",
    name: "a front matter line without a colon",
    breakIt: (copy) => copy.replace(LOGIN, "who: guest", "who guest"),
    file: LOGIN,
    line: 5,
    subject: LOGIN_SUBJECT,
  },
  {
    code: "GR1003",
    name: "a flow without `since`",
    breakIt: (copy) => copy.replace(LOGIN, "since: 1.0\n", ""),
    file: LOGIN,
    line: 1,
    subject: LOGIN_SUBJECT,
  },
  {
    code: "GR1004",
    name: "a README date in the wrong form",
    breakIt: (copy) => copy.replace(CATALOG_README, "updated: 2026-11-10", "updated: 10/11/2026"),
    file: CATALOG_README,
    line: 6,
    subject: { feature: "catalog" },
  },
  {
    code: "GR1005",
    name: "a README key not in the template",
    breakIt: (copy) =>
      copy.replace(
        "grimoire/features/orders/README.md",
        "id: orders\n",
        "id: orders\nowner: sam\n",
      ),
    file: "grimoire/features/orders/README.md",
    line: 3,
    subject: { feature: "orders" },
  },
  {
    code: "GR1006",
    name: "a page without its title",
    breakIt: (copy) =>
      copy.replace("grimoire/apps/web-client/pages/home/README.md", "# Home\n", ""),
    file: "grimoire/apps/web-client/pages/home/README.md",
    line: 5,
    subject: { app: "web-client" },
  },
  {
    code: "GR1007",
    name: "a README heading not in the template",
    breakIt: (copy) =>
      copy.replace(
        "grimoire/features/auth/README.md",
        "## Flows",
        "## Notes\nfree text\n\n## Flows",
      ),
    file: "grimoire/features/auth/README.md",
    line: "## Notes",
    subject: { feature: "auth" },
  },
  {
    code: "GR1008",
    name: "a route step without its method",
    breakIt: (copy) => copy.replace(PLACE_ORDER, "POST /api/orders", "/api/orders"),
    file: PLACE_ORDER,
    line: "2. route",
    subject: { feature: "orders", flow: "orders/place-order" },
  },
  {
    code: "GR1009",
    name: "a step of an unknown kind",
    breakIt: (copy) => copy.replace(LOGIN, "1. route   POST", "1. request   POST"),
    file: LOGIN,
    line: "1. request",
    subject: LOGIN_SUBJECT,
  },
  {
    code: "GR1010",
    name: "steps numbered 1, 3",
    breakIt: (copy) => copy.replace(SIGN_UP, "2. job", "3. job"),
    file: SIGN_UP,
    line: "3. job",
    subject: { feature: "auth", flow: "auth/sign-up" },
  },
  {
    code: "GR1011",
    name: "a case with a question and no answer",
    breakIt: (copy) =>
      copy.replace(LOGIN, "- invalid input   a missing password → 422", "- invalid input"),
    file: LOGIN,
    line: "- invalid input",
    subject: LOGIN_SUBJECT,
  },
  {
    code: "GR1012",
    name: "a case question answered nowhere",
    breakIt: (copy) => copy.replace(BROWSE, "- limits                 50 products per page\n", ""),
    file: BROWSE,
    line: "## Cases",
    subject: { feature: "catalog", flow: "catalog/browse-products" },
  },
  {
    code: "GR1013",
    name: "a criterion written AC1",
    breakIt: (copy) => copy.replace(LOGIN, "- AC-1   valid", "- AC1   valid"),
    file: LOGIN,
    line: "- AC1",
    subject: LOGIN_SUBJECT,
  },
  {
    code: "GR1014",
    name: "AC-1 used twice",
    breakIt: (copy) => copy.replace(SIGN_UP, "- AC-2   an unverified", "- AC-1   an unverified"),
    file: SIGN_UP,
    line: "- AC-1   an unverified",
    subject: { feature: "auth", flow: "auth/sign-up" },
  },
  {
    code: "GR1015",
    name: "a changelog entry with no word",
    breakIt: (copy) =>
      copy.replace(
        "grimoire/features/orders/CHANGELOG.md",
        "- 1.0  added     place-order: customers pay for their cart and get a confirmation email",
        "- 1.0",
      ),
    file: "grimoire/features/orders/CHANGELOG.md",
    line: "- 1.0",
    subject: { feature: "orders" },
  },
  {
    code: "GR1016",
    name: "a changelog entry with an unknown word",
    breakIt: (copy) => copy.replace(AUTH_CHANGELOG, "1.0  added", "1.0  created"),
    file: AUTH_CHANGELOG,
    line: "created",
    subject: { feature: "auth" },
  },
  {
    code: "GR1017",
    name: "a release heading without parentheses",
    breakIt: (copy) =>
      copy.replace(AUTH_CHANGELOG, "## 1.0.0 (2026-10-01)", "## 1.0.0 - 2026-10-01"),
    file: AUTH_CHANGELOG,
    line: "## 1.0.0",
    subject: { feature: "auth" },
  },
  {
    code: "GR1018",
    name: "a blocks table with a wrong column",
    breakIt: (copy) =>
      copy.replace("grimoire/apps/web-admin/pages/orders/README.md", "Who sees it", "Audience   "),
    file: "grimoire/apps/web-admin/pages/orders/README.md",
    line: "| Block",
    subject: { app: "web-admin" },
  },
  {
    code: "GR1019",
    name: "a flow id that is not its file name",
    breakIt: (copy) => copy.replace(LOGIN, "id: login", "id: log-in"),
    file: LOGIN,
    line: 2,
    subject: LOGIN_SUBJECT,
  },
  {
    code: "GR1020",
    name: "a notes file in a feature folder",
    breakIt: (copy) => create(copy, "grimoire/features/catalog/notes.md", "# Notes\n"),
    file: "grimoire/features/catalog/notes.md",
    line: 1,
    subject: { feature: "catalog" },
  },
  {
    code: "GR1021",
    name: "an app folder without README.md",
    breakIt: (copy) =>
      create(
        copy,
        "grimoire/apps/kiosk/layouts/main.md",
        "# Main\n\n## Blocks\n| Block | Flow | Who sees it | Changes with |\n| - | - | - | - |\n",
      ),
    file: "grimoire/apps/kiosk/README.md",
    line: 1,
    subject: { app: "kiosk" },
  },
  {
    code: "GR1022",
    name: "two tasks with one id",
    breakIt: (copy) => create(copy, "grimoire/tasks/open/T-015-zz-copy.md", TASK("T-015")),
    file: "grimoire/tasks/open/T-015-zz-copy.md",
    line: 2,
    subject: { task: "T-015" },
  },
  {
    code: "GR1023",
    name: "a task file without its id in the name",
    breakIt: (copy) => create(copy, "grimoire/tasks/open/wishlist-later.md", TASK("T-016")),
    file: "grimoire/tasks/open/wishlist-later.md",
    line: 1,
  },
  {
    code: "GR1024",
    name: "a release file without its end marker",
    breakIt: (copy) =>
      copy.replace("grimoire/releases/1.0.0.md", "<!-- grimoire:collected:end -->\n", ""),
    file: "grimoire/releases/1.0.0.md",
    line: "<!-- grimoire:collected:start -->",
  },
  {
    code: "GR1025",
    name: "a changelog that is not UTF-8",
    breakIt: (copy) =>
      create(copy, AUTH_CHANGELOG, Uint8Array.from([0x23, 0x20, 0xc3, 0x28, 0x0a])),
    file: AUTH_CHANGELOG,
    line: 1,
    subject: { feature: "auth" },
  },
  {
    code: "GR1026",
    name: "a README flow with no file",
    breakIt: (copy) =>
      copy.replace(
        CATALOG_README,
        "- wishlist          save",
        "- reviews   customers review products\n- wishlist          save",
      ),
    file: CATALOG_README,
    line: "- reviews",
    subject: { feature: "catalog", flow: "catalog/reviews" },
  },
  {
    code: "GR1027",
    name: "a flow file the README does not list",
    breakIt: (copy) =>
      create(copy, "grimoire/features/orders/flows/cancel-order.md", cancelOrderFlow()),
    file: "grimoire/features/orders/flows/cancel-order.md",
    line: 1,
    subject: { feature: "orders", flow: "orders/cancel-order" },
  },
  {
    code: "GR1028",
    name: "a Differs by app line with an app and no text",
    breakIt: (copy) =>
      copy.replace(
        NEW_ARRIVALS,
        "- mobile   uses the device's country when the customer has none",
        "- mobile",
      ),
    file: NEW_ARRIVALS,
    line: "- mobile",
    subject: { feature: "catalog", flow: "catalog/new-arrivals" },
  },
];

function cancelOrderFlow(): string {
  return [
    "---",
    "id: cancel-order",
    "since: 1.0",
    "status: shipped",
    "who: customer",
    "---",
    "",
    "# Cancel an order",
    "",
    "## Steps",
    "1. route   DELETE /api/orders/:id",
    "",
    "## Cases",
    "- invalid input          does not apply: no input",
    "- not allowed            another customer's order → 403",
    "- not found              an unknown order → 404",
    "- duplicate              does not apply: cancelling twice keeps it cancelled",
    "- limits                 does not apply: one order",
    "- expiry                 a shipped order cannot be cancelled",
    "- double submit          does not apply: idempotent",
    "- outside service down   the refund waits",
    "",
    "## Acceptance criteria",
    "- AC-1   a cancelled order is not shipped",
    "",
  ].join("\n");
}

let base: GrimoireFinding[] = [];
let copy: FixtureCopy;

beforeAll(async () => {
  base = (await parseGrimoire(shopRoot)).findings;
});

afterAll(() => copy?.remove());

describe("structure codes", () => {
  it("has a case for every structure code in the catalog", () => {
    const structure = GRIMOIRE_CODE_LIST.filter(
      (definition) => definition.area === "structure",
    ).map((definition) => definition.code);

    expect(CASES.map((entry) => entry.code)).toEqual(structure);
  });

  describe.each(CASES)("$code", (entry) => {
    it(`is reported for ${entry.name}`, async () => {
      copy = copyFixture();

      try {
        entry.breakIt(copy);

        const { findings } = await parseGrimoire(copy.root);
        const line =
          typeof entry.line === "number"
            ? entry.line
            : copy
                .read(entry.file)
                .split(/\r?\n/)
                .findIndex((text) => text.includes(entry.line as string)) + 1;
        const found = findings.filter((finding) => finding.code === entry.code);

        expect(line).toBeGreaterThan(0);
        expect(found.length, JSON.stringify(findings, null, 2)).toBeGreaterThan(0);
        expect(found[0]).toMatchObject({
          severity: explainGrimoireCode(entry.code)?.severity,
          at: { file: entry.file, line, column: null },
          expected: false,
          subject: { file: entry.file, ...(entry.subject ?? {}) },
          hint: explainGrimoireCode(entry.code)?.fix,
        });
        expect(found[0]?.message).not.toBe("");
      } finally {
        copy.remove();
      }
    });

    it("is not reported on the base fixture", () => {
      expect(base.filter((finding) => finding.code === entry.code)).toEqual([]);
    });
  });
});

describe("findings never throw and come sorted", () => {
  it("returns findings in file and line order for a project with many problems", async () => {
    copy = copyFixture();

    try {
      for (const entry of CASES) {
        // Some cases break the same text another case already broke.
        try {
          entry.breakIt(copy);
        } catch {
          continue;
        }
      }

      const { findings } = await parseGrimoire(copy.root);
      const keys = findings.map(
        (finding) => `${finding.at?.file ?? ""}:${String(finding.at?.line ?? 0).padStart(6, "0")}`,
      );

      expect(new Set(findings.map((finding) => finding.code)).size).toBeGreaterThan(15);
      expect(keys).toEqual([...keys].sort());
    } finally {
      copy.remove();
    }
  });
});
