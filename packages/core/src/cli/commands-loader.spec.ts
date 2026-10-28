import { beforeEach, describe, expect, it, vi } from "vitest";

const getFilesFromDirectory = vi.fn();
const load = vi.fn();

vi.mock("../dev-server/utils", () => ({ getFilesFromDirectory }));
vi.mock("../dev-server/files-orchestrator", () => ({ filesOrchestrator: { load } }));
vi.mock("../utils", () => ({ srcPath: (path: string) => `/app/src/${path}` }));
vi.mock("../utils/normalized-path", () => ({
  Path: { toRelative: (path: string) => path.replace("/app/", "") },
}));

const { CLICommandsLoader } = await import("./commands-loader");

const command = (name: string) => ({ default: { name, $relativePath: vi.fn() } });

describe("CLICommandsLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFilesFromDirectory.mockResolvedValue([
      "/app/src/app/x/commands/import.command.ts",
      "/app/src/app/x/commands/import.command.spec.ts",
      "/app/src/app/x/commands/import.command.test.ts",
      "/app/src/app/x/commands/helper.test.tsx",
    ]);
    load.mockImplementation(async (file: string) => command(file));
  });

  it("scanAll never imports spec or test files", async () => {
    await new CLICommandsLoader().scanAll();

    expect(load.mock.calls.map(([file]) => file)).toEqual(["src/app/x/commands/import.command.ts"]);
  });

  it("locate never imports spec or test files", async () => {
    await new CLICommandsLoader().locate("missing");

    expect(load.mock.calls.map(([file]) => file)).toEqual(["src/app/x/commands/import.command.ts"]);
  });
});
