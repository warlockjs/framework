// Value barrel for the utility tools. The `ai.tools.calculator` /
// `ai.tools.dateTime` augmentation + runtime registration live in
// `../register` (one consolidated block), so this file is a pure re-export of
// the factories. `dateTimeTool`'s injectable-clock `deps` is a test/advanced
// seam exposed only by importing the factory directly.
export { calculatorTool } from "./calculator";
export { dateTimeTool, type Clock, type DateTimeToolDeps } from "./date-time";
