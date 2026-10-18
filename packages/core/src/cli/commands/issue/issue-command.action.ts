import type { CommandActionData } from "../../../commands/types";
import { collectIssueEnvironment, type IssueEnvironment } from "./collect-environment";

export type FrameworkIssueType = "bug" | "feature";
export type IssueReport = { schemaVersion: 1; environment: IssueEnvironment; url: string };

// A conservative budget, not a promised GitHub limit. GitHub documents 414
// responses for oversized URLs, and form prefills use field IDs:
// https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue
// https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema
export const ISSUE_URL_MAX_LENGTH = 7_500;
const TRUNCATION_NOTE =
  "\n\n[Truncated for URL length. Paste the remaining reviewed warlock issue output here.]";

export function formatIssueEnvironment(environment: IssueEnvironment): string {
  return JSON.stringify(environment, null, 2);
}

/** A draft only: the reporter must replace prompts and review before filing. */
export function frameworkIssueBody(
  type: FrameworkIssueType,
  environment: IssueEnvironment,
): string {
  return [
    type === "bug"
      ? "### Summary\nDescribe the framework bug."
      : "### Problem / use case\nDescribe the missing framework capability.",
    `### Environment / warlock issue output\n\n\`\`\`json\n${formatIssueEnvironment(environment)}\n\`\`\``,
    "### Minimal reproduction\nProvide public, minimal code and exact steps (a capability example for a feature).",
    type === "bug"
      ? "### Expected behavior\nWhat should happen?"
      : "### Proposed behavior\nWhat should the framework support?",
    "### Actual / current behavior\nWhat happens today?",
    ...(type === "feature"
      ? ["### Alternatives considered\nDescribe workarounds and their limitations."]
      : []),
    "### Sanitized logs / doctor output\nPaste relevant logs and warlock doctor --json output, or explain why unavailable / not applicable.",
    "### Checks\n- [ ] Searched existing issues and checked installed-version CHANGELOG and skills.\n- [ ] Removed secrets, tokens, .env, customer data, proprietary code and private app names.\n- [ ] User reviewed this complete draft and approved filing.",
  ].join("\n\n");
}

/** Encode all text, cap the entire ASCII URL and preserve Unicode code points. */
export function createFrameworkIssueUrl(
  type: FrameworkIssueType,
  title: string,
  environment: IssueEnvironment,
): string {
  const body = Array.from(frameworkIssueBody(type, environment));
  const environmentText = Array.from(formatIssueEnvironment(environment));
  const makeUrl = (length: number): string => {
    const shorten = (text: string[]): string =>
      text.length > length ? text.slice(0, length).join("") + TRUNCATION_NOTE : text.join("");
    const url = new URL("https://github.com/warlockjs/framework/issues/new");
    url.search = new URLSearchParams({
      template: `${type}.yml`,
      title: Array.from(title).slice(0, 256).join(""),
      body: shorten(body),
      // YAML issue forms prefill by field ID, rather than the Markdown body.
      environment: shorten(environmentText),
    }).toString();
    return url.href;
  };
  let low = 0;
  let high = Math.max(body.length, environmentText.length);
  if (makeUrl(high).length <= ISSUE_URL_MAX_LENGTH) return makeUrl(high);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (makeUrl(middle).length <= ISSUE_URL_MAX_LENGTH) low = middle;
    else high = middle - 1;
  }
  return makeUrl(low);
}

export async function issueCommandAction({ options }: CommandActionData): Promise<void> {
  const type = options.type ?? "bug";
  if (type !== "bug" && type !== "feature") throw new Error("--type must be bug or feature.");
  if (options.title !== undefined && typeof options.title !== "string")
    throw new Error("--title must be a string.");
  const title = options.title ?? (type === "bug" ? "[Bug] " : "[Feature] ");
  const environment = collectIssueEnvironment();
  const report: IssueReport = {
    schemaVersion: 1,
    environment,
    url: createFrameworkIssueUrl(type, title, environment),
  };
  if (options.json === true) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("Environment (review before sharing):");
  console.log(formatIssueEnvironment(environment));
  console.log(
    "\nReview the draft, remove private information and ask the user before filing. Nothing has been sent.",
  );
  console.log(report.url);
}
