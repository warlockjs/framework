import { expect, it } from "vitest";
import { supervisor } from "../src/supervisor";

it.each([null, undefined, false, 3, "bad", {}, [], { owner: null }, { owner: "" }, { owner: 3 }])(
  "reports the owner option for invalid configuration",
  (input) => {
    expect(() => Reflect.apply(supervisor, undefined, [input])).toThrow(/configuration: owner/);
  },
);
it.each([undefined, null, false, 3, "", "  ", []])(
  "reports an invalid registry option",
  (registry) => {
    expect(() => Reflect.apply(supervisor, undefined, [{ owner: "example", registry }])).toThrow(
      /configuration: registry/,
    );
  },
);
