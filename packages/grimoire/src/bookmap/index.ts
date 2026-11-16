/**
 * Book maps and collected indexes (owned by T-128).
 *
 * - `features/<feature>/bookmap.json`: own and borrowed files, routes, pages
 *   per app, own files no flow reaches.
 * - `features/<feature>/flows/<flow>.bookmap.json`: the files behind each
 *   step, the tests of each criterion with their last result, and the blocks
 *   that show the flow.
 * - `features/index.json` and `tasks/index.json`.
 *
 * Rules for the files behind a step:
 * - `route`: routes with the same path and method (`ALL` matches any); the
 *   entry is the handler file (else the routes file); files are the handler's
 *   import closure plus the routes file alone. No route facts → `found: null`.
 * - `page`: pages of the sites and screens of the mobile apps matched to the
 *   feature's apps, compared with params written one way (`:id` ≡ `[id]`) and
 *   no trailing `/`; the entry is the first page or screen file; files are the
 *   import closures of the page and setup files (layouts left out).
 * - `mail`, `job`, `event`, `notification`: the named thing's file and its closure.
 * - `outside service`: `found: null`. `affects`: found when the feature (and
 *   flow) exists; no files.
 */
export { annotationsFrom, buildCollectedFiles, flowFileId, type CollectedInput } from "./build";
export { normalizeRoutePath } from "./steps";
export { writeCollectedFiles } from "./write";
