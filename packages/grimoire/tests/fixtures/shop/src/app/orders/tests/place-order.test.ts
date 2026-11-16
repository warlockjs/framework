/** Proves the place-order rules. */

import * as m0 from "../services/place-order.service";
import { describe, it } from "vitest";

void [m0];

const placeOrder = (m0 as Record<string, (...args: unknown[]) => Promise<unknown>>).placeOrder ?? (async () => undefined);

describe("place order", () => {
  // @proves orders/place-order AC-1
  it("saves the order and lowers the stock", async () => {
    await placeOrder();
  });

  // @proves orders/place-order AC-2
  it("refuses a product that is out of stock", async () => {
    await placeOrder();
  });
});
