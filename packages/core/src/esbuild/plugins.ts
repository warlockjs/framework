import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import type { Plugin, PluginBuild } from "esbuild";
import path from "path";
import { warlockPath } from "./../utils";

// Keep track of the active server process
let serverProcess: ChildProcess | null = null;

// Core files that require server restart
const CORE_PATTERNS = [
  /src\/config\//,
  /src\/bootstrap\//,
  /src\/warlock\/environment/,
  /\.env$/,
  /warlock\.config\.ts$/,
];

// Files that should be hot reloaded
const HOT_RELOAD_PATTERNS = [
  /src\/app\/.*\/routes\.ts$/,
  /src\/app\/.*\/controllers\//,
];

// This plugin manages the build process and server
export const startServerPlugin: Plugin = {
  name: "start-server",
  setup(build: PluginBuild) {
    build.onEnd(result => {
      if (result.errors.length > 0) {
        console.error("Build failed:", result.errors);
        return;
      }

      if (!result.metafile) return;

      // Get changed files from metafile
      const changedFiles = Object.keys(result.metafile.inputs);

      // Check if any core files changed
      const requiresRestart = changedFiles.some(file =>
        CORE_PATTERNS.some(pattern => pattern.test(file)),
      );

      if (requiresRestart) {
        console.log("Core files changed, restarting server...");
        if (serverProcess) {
          serverProcess.kill();
          serverProcess = null;
        }
        startServer();
      } else {
        // Check for hot reloadable files
        const hotReloadFiles = changedFiles.filter(file =>
          HOT_RELOAD_PATTERNS.some(pattern => pattern.test(file)),
        );

        if (hotReloadFiles.length > 0) {
          console.log("Hot reloading files:", hotReloadFiles);
          for (const [outputFile, info] of Object.entries(
            result.metafile.outputs,
          )) {
            if (!info.inputs) continue;

            const inputFile = Object.keys(info.inputs)[0];
            if (hotReloadFiles.includes(inputFile)) {
              try {
                const modulePath = path.resolve(outputFile);
                if (require.cache[modulePath]) {
                  delete require.cache[modulePath];
                }
                import(`${modulePath}?update=${Date.now()}`).catch(err => {
                  console.error(`Error hot reloading ${outputFile}:`, err);
                });
              } catch (error) {
                console.error(`Failed to hot reload ${outputFile}:`, error);
              }
            }
          }
        }
      }
    });
  },
};

function startServer() {
  serverProcess = spawn(
    "node",
    ["--enable-source-maps", warlockPath("http.js")],
    {
      stdio: "inherit",
      cwd: process.cwd(),
    },
  );

  serverProcess.on("error", err => {
    console.error("Server process error:", err);
  });

  serverProcess.on("exit", state => {
    if (state !== null) {
      process.exit(state);
    }
  });
}
