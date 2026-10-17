import type { PageConfig } from "@warlock.js/web";

export async function loader() {
  return { runtime: process.versions.bun ? "bun" : process.versions.deno ? "deno" : "node" };
}

export const config = {
  route: { path: "/", name: "home" },
  metadata: { title: "Runtime acceptance" },
} satisfies PageConfig<typeof loader>;
