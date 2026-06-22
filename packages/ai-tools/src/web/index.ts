// Value barrel for the web tools. The `ai.tools.webSearch` / `ai.tools.fetchUrl`
// augmentation + runtime registration live in `../register` (one consolidated
// block), so this file is a pure re-export of the factories.
export { webSearchTool } from "./web-search";
export { fetchUrlTool } from "./fetch-url";
