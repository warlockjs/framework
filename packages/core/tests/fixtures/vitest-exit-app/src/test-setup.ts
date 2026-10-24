import { setupTest, teardownTest } from "@warlock.js/core/tests";
import { afterAll, expect } from "vitest";

await setupTest({ importModule: (file) => import(file), file: expect.getState().testPath });

afterAll(teardownTest);
