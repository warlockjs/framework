import { createMemoryAiRollupStore } from "../../../src/ai/rollup/memory-store";
import { describeAiRollupStoreContract } from "./store-contract";

describeAiRollupStoreContract("memory", () => createMemoryAiRollupStore());
