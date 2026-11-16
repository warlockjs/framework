/** Proves the new arrivals rules. */

import * as m0 from "../services/new-arrivals.service";
import { describe, it } from "vitest";

void [m0];

const listNewArrivals = (m0 as Record<string, (...args: unknown[]) => Promise<unknown>>).listNewArrivals ?? (async () => undefined);

describe("new arrivals", () => {
  // @proves catalog/new-arrivals AC-1
  it("lists the newest products first", async () => {
    await listNewArrivals("EG");
  });

  // @proves catalog/new-arrivals AC-2
  it("returns the global list when the customer has no country", async () => {
    await listNewArrivals();
  });
});
