/** Shapes a user for the API response, without private fields. */
import { defineResource } from "@warlock.js/core";

export const UserResource = defineResource({
  schema: {
    id: ["publicId", "string"],
    name: "string",
    email: "string",
    image: "storageUrl",
    createdAt: "date",
    updatedAt: "date",
    type: () => "user",
  },
});
