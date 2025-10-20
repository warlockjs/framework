import { fileExistsAsync, getFileAsync, putFileAsync } from "@mongez/fs";
import { fork, type ChildProcess } from "child_process";
import { warlockCorePackagePath } from "src/warlock/utils/internal";
import { warlockPath } from "../utils";

export let serverProcess: ChildProcess | null = null;

export async function restartServer() {
  if (serverProcess) {
    serverProcess.kill();
  } else {
    // make sure warlock-loader.mjs is in the .warlock directory
    const loaderFilePath = warlockPath("warlock-loader.mjs");
    // IMPORTANT: If this is part of the framework development, you need to manually
    // create warlock-loader.mjs file in .warlock directory and copy contents from ./warlock-loader.mjs file
    // otherwise, it will work normally (framework being used in production)
    if (!(await fileExistsAsync(loaderFilePath))) {
      const warlockLoaderContents = await getFileAsync(
        warlockCorePackagePath("bin/warlock-loader.mjs"),
      );
      await putFileAsync(loaderFilePath, warlockLoaderContents);
    }
  }

  serverProcess = fork("./.warlock/http.ts", {
    execArgv: [
      "--import",
      `data:text/javascript,import { register } from "node:module";
       import { pathToFileURL } from "node:url";
       register("./.warlock/warlock-loader.mjs", pathToFileURL("./"));`,
    ],
    stdio: "inherit",
    cwd: process.cwd(),
  });
}
