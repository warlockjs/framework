import { describe, expect, it } from "vitest";
import { CLICommand } from "../../../../src/cli/cli-command";
import { doctorCommand } from "../../../../src/cli/commands/doctor.command";
import { defaultDoctorChecks } from "../../../../src/cli/commands/doctor/checks";
import { frameworkCommands } from "../../../../src/cli/framework-cli-commands";

/**
 * Validates the `doctor` command DEFINITION (name, preload plan, registration)
 * and the default check set wiring — without executing the action, which would
 * bootstrap an app and call `process.exit`.
 */
describe("doctorCommand definition", () => {
  it("is a CLICommand named doctor with a description", () => {
    expect(doctorCommand).toBeInstanceOf(CLICommand);
    expect(doctorCommand.name).toBe("doctor");
    expect(doctorCommand.commandDescription).toBeTruthy();
  });

  it("loads config + bootstrap for introspection but starts no connectors", () => {
    expect(doctorCommand.commandPreload).toMatchObject({
      config: true,
      env: true,
      bootstrap: true,
    });

    // DELIBERATE: doctor must not open DB/cache/socket connections.
    expect(doctorCommand.commandPreload?.connectors).toBeUndefined();
  });

  it("defines an action and takes no options", () => {
    expect(doctorCommand.commandAction).toBeTypeOf("function");
    expect(doctorCommand.commandOptions).toEqual([]);
  });
});

describe("doctor command registration", () => {
  it("is registered in the framework command list", () => {
    expect(frameworkCommands).toContain(doctorCommand);
  });
});

describe("default doctor check set", () => {
  it("includes every documented check exactly once", () => {
    const names = defaultDoctorChecks.map((check) => check.name);

    expect(names).toEqual([
      "routes",
      "config",
      "connectors",
      "optional-peers",
      "health",
      "release-hygiene",
    ]);
  });

  it("every check exposes a runnable run() function", () => {
    for (const check of defaultDoctorChecks) {
      expect(check.run).toBeTypeOf("function");
    }
  });
});
