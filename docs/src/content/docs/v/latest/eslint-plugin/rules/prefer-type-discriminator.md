---
title: prefer-type-discriminator
description: Use type, not kind, as the discriminator of a union.
sidebar:
  order: 9
---

**Strict:** error

Warlock tags its unions with `type` (`{ type: "text" } | { type: "image" }`), so
every union narrows the same way. The rule reports a `kind` property whose type
is a literal or a union of literals in a type literal or interface. A `kind`
typed as `string` or as an enum is left alone.

## Incorrect

```ts
type Shape = { kind: "circle"; radius: number } | { kind: "square"; size: number };
```

## Correct

```ts
type Shape = { type: "circle"; radius: number } | { type: "square"; size: number };
```
