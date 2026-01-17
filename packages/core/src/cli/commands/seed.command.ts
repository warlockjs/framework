import { seedCommandAction } from "../../database/seed-command-action";
import { command } from "../cli-command";

export const seedCommand = command({
  action: seedCommandAction,
  name: "seed",
  description: "Run database seeds",
  preload: {
    config: ["database", "log"],
    env: true,
    connectors: ["database"],
  },
  options: [
    {
      text: "--fresh, -f",
      description: "Drop all tables records and run seeds",
      type: "boolean",
    },
  ],
});
