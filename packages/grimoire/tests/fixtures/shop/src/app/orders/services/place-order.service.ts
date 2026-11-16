/** Places an order and lowers the stock of its products. */

import * as m0 from "../events/order-placed.event";
import * as m1 from "../jobs/send-receipt.job";
import * as m2 from "../mails/order-confirmation.mail";
import * as m3 from "app/catalog/repositories/products.repository";

void [m0, m1, m2, m3];

/** Saves the order, lowers stock, then sends the confirmation. */
export function placeOrder(..._args: unknown[]): unknown {
  return undefined;
}
