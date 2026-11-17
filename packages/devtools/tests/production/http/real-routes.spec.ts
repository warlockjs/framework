import { describe, expect, it } from "vitest";
import { createApp } from "./app";

// No stand-ins here: the shared route files of the other packages run as shipped.
describe("the shared route files inside the production mount", () => {
  it("mounts them without error and keeps every one behind the gate", async () => {
    const t = await createApp({ notFound: "custom" });
    const session = await t.signIn("viewer@example.com");

    for (const route of ["/", "/api/requests", "/api/routes", "/api/panels"]) {
      const anonymous = await t.send("GET", route);

      expect(anonymous.statusCode, route).toBe(route === "/" ? 200 : 404);

      if (route !== "/") expect(anonymous.body, route).toBe("app not found");
    }

    const requests = await t.send("GET", "/api/requests", { session });

    expect(requests.statusCode).toBeLessThan(500);
  });
});
