import { createMemoryStore } from "../../../src/production/store/memory-store";
import { describeStoreContract } from "./store-contract";

describeStoreContract("memory", () => {
  let now = 1000;

  return { store: createMemoryStore({ now: () => now }), setNow: (at) => void (now = at) };
});
