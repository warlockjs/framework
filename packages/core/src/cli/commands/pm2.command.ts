import { command } from "../../commands/cli-command";
import { pm2CommandAction } from "./pm2/pm2-command.action";

export const pm2Command = command({
  name: "pm2 <action>",
  description: "Optional PM2 tooling: init an ecosystem file or reload only this app",
  // Read config without running bootstrap, prestart or any connector.
  preload: { warlockConfig: true, config: ["app", "http", "socket"] },
  action: pm2CommandAction,
  options: [
    { text: "--project", type: "string", description: "Project name (default: package.json name)" },
    { text: "--app", type: "string", description: "App name (default: app.appName or app)" },
    { text: "--cluster", type: "boolean", description: "init: use cluster mode (default: fork)" },
    {
      text: "--instances",
      type: "string",
      description: "init with --cluster: worker count or max (default: 2)",
    },
    {
      text: "--listen-timeout",
      type: "string",
      description: "init: readiness timeout in ms (default: 30000)",
    },
    {
      text: "--id",
      type: "string",
      description: "reload: one PM2 id, verified to belong to this app",
    },
  ],
});
