import { expect, it } from "vitest";
import { addCommand } from "./add.command";

it("loads app configuration before feature generators read configured locales", () => {
  expect(addCommand.commandPreload).toEqual({ config: ["app"] });
});
