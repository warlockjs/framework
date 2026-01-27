import { Application } from "../application";
import { DevelopmentServer } from "../dev2-server/development-server";
import { startDevelopmentServer } from "../dev2-server/start-development-server";

let developmentServer: DevelopmentServer;

export async function startHttpTestServer() {
  Application.setRuntimeStrategy("development");
  Application.setEnvironment("test");
  developmentServer = await startDevelopmentServer();
}

export async function stopHttpTestServer() {
  await developmentServer.shutdown();
}
