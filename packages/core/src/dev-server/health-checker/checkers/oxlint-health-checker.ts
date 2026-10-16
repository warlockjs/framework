import type { FileManager } from "../../file-manager";
import type { FileHealthResult } from "../file-health-result";
import { OxlintRunner } from "../oxlint-runner";
import { BaseHealthChecker } from "./base-health-checker";

export class OxlintHealthChecker extends BaseHealthChecker {
  public name = "Oxlint";
  public workerPath = "./workers/oxlint-health.worker";
  private runner = new OxlintRunner();

  public initialize(): this {
    this.runner.initialize(process.cwd());
    return this;
  }

  public async validate(file: FileManager, result: FileHealthResult): Promise<FileHealthResult> {
    try {
      const [checked] = await this.runner.checkFiles([
        { path: file.absolutePath, relativePath: file.relativePath },
      ]);
      if (checked?.errors.length) result.addErrors(checked.errors);
      if (checked?.warnings.length) result.addWarnings(checked.warnings);
    } catch (error) {
      console.warn(
        "Oxlint Health Checker:",
        error instanceof Error ? error.message : String(error),
      );
    }
    return result;
  }
}
