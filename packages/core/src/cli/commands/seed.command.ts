import { seedCommandAction } from "../../database/seed-command-action";
import { command } from "../cli-command";

export const seedCommand = command({
  action: seedCommandAction,
  name: "seed",
  description: "Run database seeds",
  preload: {
    config: true,
    env: true,
    bootstrap: true,
    connectors: ["database", "cache", "logger"],
  },
  options: [
    {
      text: "--fresh, -f",
      description: "Drop all tables records and run seeds",
      type: "boolean",
    },
    {
      text: "--list, -l",
      description: "Display the seeds list in order without execution",
      type: "boolean",
    },
    {
      text: "--transaction, -t",
      description: "Run seeds in a transaction",
      type: "boolean",
      defaultValue: true,
    },
    {
      text: "--drop, -d",
      description:
        'Undo seeded data — delete tracked records (reverse order) and reset the seed log; scope to one seeder with --drop="Seed Name"',
      type: "string",
    },
  ],
});
