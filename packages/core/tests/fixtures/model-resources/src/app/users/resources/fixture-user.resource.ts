import { defineResource } from "@warlock.js/core";

export const FixtureUserResource = defineResource({
  schema: {
    id: "number",
    name: "string",
    createdAt: "date",
  },
});
