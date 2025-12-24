import { DevelopmentServer } from "../../dev2-server/development-server";
import { command } from "../cli-command";
import { displayStartupBanner } from "../cli-commands.utils";

export const devServerCommand = command({
  name: "dev",
  description: "Start development server",
  persistent: true,
  preload: {
    config: true, // load all config
    bootstrap: true,
    connectors: true, // load all connectors
  },
  preAction: async () => {
    await displayStartupBanner();
  },
  action: async () => {
    const server = new DevelopmentServer();

    await server.start();
  },
}).option("--fresh", "Start Fresh Development server");
