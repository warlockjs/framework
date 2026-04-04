# Immutable Validator Method Migration

## Context

`BaseValidator` now supports an **immutable-by-default** pattern.

Every chainable method must return a new cloned instance by default.
When `.mutable` is explicitly set on an instance, all methods mutate in place.

This is controlled through two things already implemented in `base-validator.ts`:

- `protected isMutable = false` — flag tracking mutation mode
- `public get mutable` — sets `isMutable = true`, returns `this`
- `public get immutable` — sets `isMutable = false`, returns `this`
- `protected get instance` — returns `this` if mutable, or `this.clone()` if not

The `addRule()`, `addMutator()`, and `addTransformer()` methods in `BaseValidator` already
call `this.instance` internally, so **any method that delegates entirely to those three
is already correct and needs no changes**.

---

## Files to Migrate

Migrate every public chainable method in the following files:

```
src/validators/string-validator.ts
src/validators/number-validator.ts
src/validators/array-validator.ts
src/validators/boolean-validator.ts
src/validators/date-validator.ts
src/validators/scalar-validator.ts
src/validators/record-validator.ts
src/validators/tuple-validator.ts
src/validators/union-validator.ts
src/validators/object-validator.ts
src/validators/methods/equality-conditional-methods.ts
src/validators/methods/forbidden-methods.ts
src/validators/methods/present-methods.ts
```

> `base-validator.ts` and `methods/required-methods.ts` are already fully migrated. Do not touch them.

---

## Rules

### Rule 1: Methods that only call `addRule`, `addMutator`, or `addTransformer`

These already go through `this.instance` internally. **Just return the result directly — no changes needed to the body, only ensure you return the value.**

**Before:**
```ts
public email(errorMessage?: string) {
  this.addRule(emailRule, errorMessage);
  return this;
}
```

**After:**
```ts
public email(errorMessage?: string) {
  return this.addRule(emailRule, errorMessage);
}
```

---

### Rule 2: Methods that call `addRule`/`addMutator` and then pass options

The `addRule` signature now accepts options as a third argument. Collapse the old 3-line pattern into a single call.

**Before:**
```ts
public min(min: number, errorMessage?: string) {
  const rule = this.addRule(minRule, errorMessage);
  rule.context.options.min = min;
  rule.context.options.scope = "global";
  return this;
}
```

**After:**
```ts
public min(min: number, errorMessage?: string) {
  return this.addRule(minRule, errorMessage, { min, scope: "global" });
}
```

---

### Rule 3: Methods with multiple options on the same rule

Same as Rule 2 — pass all options as the third argument object.

**Before:**
```ts
public between(min: number, max: number, errorMessage?: string) {
  const rule = this.addRule(betweenNumbersRule, errorMessage);
  rule.context.options.min = min;
  rule.context.options.max = max;
  rule.context.options.scope = "global";
  return this;
}
```

**After:**
```ts
public between(min: number, max: number, errorMessage?: string) {
  return this.addRule(betweenNumbersRule, errorMessage, { min, max, scope: "global" });
}
```

---

### Rule 4: Methods that directly mutate `this` properties (NOT via addRule/addMutator)

These must be updated manually to go through `this.instance`.

**Before:**
```ts
public allowUnknown(allow = true) {
  this.shouldAllowUnknown = allow;
  return this;
}
```

**After:**
```ts
public allowUnknown(allow = true) {
  const instance = this.instance;
  instance.shouldAllowUnknown = allow;
  return instance;
}
```

---

### Rule 5: Alias methods that delegate to another method on `this`

These are already correct — they return whatever the delegated method returns, which now
returns an instance. No changes needed.

```ts
// Already correct — returns whatever greaterThan() returns
public gt(value: number | string, errorMessage?: string) {
  return this.greaterThan(value, errorMessage);
}
```

---

### Rule 6: Methods in `./methods/*.ts` files (prototype augmentation)

Same rules apply. These are functions assigned to `BaseValidator.prototype`.

**Before:**
```ts
BaseValidator.prototype.someMethod = function (field: string, errorMessage?: string) {
  const rule = this.addRule(someRule, errorMessage);
  rule.context.options.field = field;
  return this;
};
```

**After:**
```ts
BaseValidator.prototype.someMethod = function (field: string, errorMessage?: string) {
  return this.addRule(someRule, errorMessage, { field });
};
```

---

## What NOT to Change

- `validate()` — runtime method, not a builder method
- `mutate()` — runtime method, not a builder method
- `clone()` — structural method, not a builder method
- `getDefaultValue()` — read-only getter
- `isOmitted()` — read-only getter
- `matchesType()` — read-only method
- `startTransformationPipeline()` — runtime method
- Any `override clone()` in subclasses — only update if it sets extra properties on `this` directly

---

## Verification Checklist

After migrating each file, verify:

- [ ] Every public method that returns `this` now goes through `this.instance` (directly or via `addRule`/`addMutator`/`addTransformer`)
- [ ] No method does `this.someProperty = value; return this;` directly — must be `const instance = this.instance; instance.someProperty = value; return instance;`
- [ ] Alias methods (e.g. `gt`, `lt`, `lengthBetween`) are untouched — they delegate correctly
- [ ] The `clone()` override in `ObjectValidator` and `ArrayValidator` does not need changes (it clones structural properties, not builder state)

---

## Example: Full File Migration (`number-validator.ts`)

### Before

```ts
public min(min: number | string, errorMessage?: string) {
  const rule = this.addRule(minRule, errorMessage);
  rule.context.options.min = min;
  rule.context.options.scope = "global";
  return this;
}

public positive(errorMessage?: string) {
  this.addRule(positiveRule, errorMessage);
  return this;
}

public abs() {
  this.addMutator(absMutator);
  return this;
}
```

### After

```ts
public min(min: number | string, errorMessage?: string) {
  return this.addRule(minRule, errorMessage, { min, scope: "global" });
}

public positive(errorMessage?: string) {
  return this.addRule(positiveRule, errorMessage);
}

public abs() {
  return this.addMutator(absMutator);
}
```
