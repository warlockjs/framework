import { command } from "../../commands/cli-command";
import { issueCommandAction } from "./issue/issue-command.action";

/** Prepare a public issue locally, even when the app cannot boot. No preload. */
export const issueCommand = command({
  name: "issue",
  description:
    "Collect a safe environment summary and prepare a framework issue URL (never submits)",
  action: issueCommandAction,
  options: [
    { text: "--type", description: "Issue type: bug (default) or feature", type: "string" },
    { text: "--title", description: "Public issue title", type: "string" },
    { text: "--json, -j", description: "Print environment and URL as JSON", type: "boolean" },
  ],
});
