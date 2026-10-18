/**
 * TypeScript Health Check Worker
 *
 * This worker runs in a dedicated thread to perform TypeScript type checking
 * without blocking the main dev server thread. It maintains a persistent
 * native compiler session for fast incremental type checking.
 *
 * Communication:
 * - Receives: { type: 'init' | 'check' | 'fileChanges' | 'shutdown', ... }
 * - Sends: { type: 'results' | 'initialized' | 'error', ... }
 */
import { existsSync } from "node:fs";
import { CompilerSession } from "../../../tooling/typescript/compiler";
import path from "node:path";
import { parentPort, workerData } from "worker_threads";

/**
 * Serialized file data received from main thread
 */
type SerializedFile = {
  /** Absolute file path */
  path: string;
  /** File content (source code) */
  content: string;
  /** Relative path for display */
  relativePath: string;
};

/**
 * Diagnostic message sent back to main thread
 */
type DiagnosticMessage = {
  type: "error" | "warning";
  message: string;
  lineNumber: number;
  columnNumber: number;
  length: number;
  filePath: string;
  relativePath: string;
};

/**
 * Health check result for a single file
 */
type FileCheckResult = {
  path: string;
  relativePath: string;
  healthy: boolean;
  errors: DiagnosticMessage[];
  warnings: DiagnosticMessage[];
};

/**
 * Messages received from main thread
 */
/**
 * Deleted file info
 */
type DeletedFile = {
  path: string;
  relativePath: string;
};

/**
 * Messages received from main thread
 */
type WorkerMessage =
  | { type: "init"; config: { cwd: string; tsconfigPath?: string } }
  | { type: "check"; files: SerializedFile[] }
  | { type: "fileChanges"; files: SerializedFile[] }
  | { type: "filesDeleted"; files: DeletedFile[] }
  | { type: "shutdown" };

/**
 * Messages sent to main thread
 */
type WorkerResponse =
  | { type: "initialized"; success: boolean; error?: string }
  | { type: "results"; results: FileCheckResult[] }
  | { type: "error"; message: string };

/** The session owns one native compiler child and closes it on shutdown. */
class TypeScriptHealthWorker {
  private session: CompilerSession | null = null;
  public initialize(config: { cwd: string; tsconfigPath?: string }): boolean {
    this.close();
    const cwd = config.cwd || process.cwd();
    const configPath = path.resolve(cwd, config.tsconfigPath ?? "tsconfig.json");
    if (existsSync(configPath)) this.session = new CompilerSession(cwd, configPath);
    return true;
  }
  public checkFiles(files: SerializedFile[]): FileCheckResult[] {
    this.session?.update(files);
    return files.map((file) => {
      const diagnostics = this.session?.diagnostics(file.path) ?? [];
      const messages: DiagnosticMessage[] = diagnostics.map((diagnostic) => ({
        type: diagnostic.severity,
        message: diagnostic.message,
        lineNumber: diagnostic.line,
        columnNumber: diagnostic.column,
        length: diagnostic.length,
        filePath: file.path,
        relativePath: file.relativePath,
      }));
      const errors = messages.filter((message) => message.type === "error");
      const warnings = messages.filter((message) => message.type === "warning");
      return {
        path: file.path,
        relativePath: file.relativePath,
        healthy: errors.length === 0 && warnings.length === 0,
        errors,
        warnings,
      };
    });
  }
  public handleFileChanges(files: SerializedFile[]): void {
    this.session?.update(files);
  }
  public handleFilesDeleted(files: DeletedFile[]): void {
    this.session?.update(
      [],
      files.map((file) => file.path),
    );
  }
  public close(): void {
    this.session?.close();
    this.session = null;
  }
}

// Create worker instance
const worker = new TypeScriptHealthWorker();

// Handle messages from main thread
parentPort?.on("message", (message: WorkerMessage) => {
  try {
    switch (message.type) {
      case "init": {
        const success = worker.initialize(message.config);
        const response: WorkerResponse = { type: "initialized", success };
        parentPort?.postMessage(response);
        break;
      }

      case "check": {
        const results = worker.checkFiles(message.files);
        const response: WorkerResponse = { type: "results", results };
        parentPort?.postMessage(response);
        break;
      }

      case "fileChanges": {
        worker.handleFileChanges(message.files);
        break;
      }

      case "filesDeleted": {
        worker.handleFilesDeleted(message.files);
        break;
      }

      case "shutdown": {
        worker.close();
        process.exit(0);
      }
    }
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    parentPort?.postMessage(response);
  }
});

// Handle initialization from workerData if provided
if (workerData?.autoInit) {
  worker.initialize({ cwd: workerData.cwd || process.cwd() });
}

parentPort?.on("close", () => worker.close());
