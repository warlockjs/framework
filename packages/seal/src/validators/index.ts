/**
 * Core Validators Export
 *
 * These validators are framework-agnostic and work with standard JavaScript types
 *
 * Note: FileValidator has been moved to framework-rules/validators
 * as it requires framework-specific UploadedFile functionality
 */

export * from "./any-validator";
export * from "./array-validator";
export * from "./base-validator";

// BaseValidator prototype augmentations — must come after base-validator export
// to ensure the class is fully initialized before augmentation.
//
// These are re-exported (not bare `import "..."`) on purpose: each module is a
// side-effect-only `declare module` augmentation. A bare side-effect import gets
// tree-shaken out of the bundled `.d.ts`, which silently drops every chainable
// rule method (`.required()`, `.optional()`, `.requiredIfEmpty()`, …) from the
// published types. Re-exporting a real marker keeps the module — and its
// augmentation — in both the runtime bundle and the type bundle.
export { equalityConditionalMethodsApplied } from "./methods/equality-conditional-methods";
export { forbiddenMethodsApplied } from "./methods/forbidden-methods";
export { presentMethodsApplied } from "./methods/present-methods";
export { requiredMethodsApplied } from "./methods/required-methods";

// Abstract intermediate bases — export after augmentations so prototype is ready
export * from "./primitive-validator";

export * from "./boolean-validator";
export * from "./computed-validator";
export * from "./date-validator";
export * from "./discriminated-union-validator";
export * from "./float-validator";
export * from "./instanceof-validator";
export * from "./int-validator";
export * from "./lazy-validator";
export * from "./literal-validator";
export * from "./managed-validator";
export * from "./number-validator";
export * from "./numeric-validator";
export * from "./object-validator";
export * from "./record-validator";
export * from "./scalar-validator";
export * from "./string-validator";
export * from "./tuple-validator";
export * from "./union-validator";
