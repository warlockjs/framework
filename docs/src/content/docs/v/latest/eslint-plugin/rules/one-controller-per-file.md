---
title: one-controller-per-file
description: Enforce one controller per file.
sidebar:
  order: 8
---

**Strict:** error

Each controller lives in its own `<name>.controller.ts`, with its validation
schema beside it. That is what `warlock generate.controller` writes, and it
keeps diffs, code search and generated route types predictable.

A top-level function, class or constant counts as a controller when its name
ends in `Controller` or it is typed as a `…RequestHandler`.

## Incorrect

```ts
export const loginController: RequestHandler = async ({ response }) => response.success();
export const logoutController: RequestHandler = async ({ response }) => response.success();
```

## Correct

```ts
// login.controller.ts
export const loginController: RequestHandler = async ({ response }) => response.success();
```

```ts
// logout.controller.ts
export const logoutController: RequestHandler = async ({ response }) => response.success();
```
