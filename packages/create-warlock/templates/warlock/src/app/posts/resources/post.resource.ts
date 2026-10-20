import { defineResource } from "@warlock.js/core";

export const PostResource = defineResource({
  schema: {
    id: ["publicId", "string"],
    slug: "string",
    title: "string",
    description: "string",
    image: "storageUrl",
  },
});
