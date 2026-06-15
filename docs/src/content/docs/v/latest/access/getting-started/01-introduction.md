---
title: "Introduction"
description: What @warlock.js/access is, the engine + resolver mental model, and when to reach for it.
sidebar:
  order: 1
  label: "Introduction"
---

`@warlock.js/access` is the authorization layer for Warlock apps. `@warlock.js/auth` gets you a logged-in `request.user`; `access` decides what that user is allowed to do.

## The mental model in one paragraph

The package owns the **engine** — wildcard matching, caching, ABAC policies, fail-closed decisions. You hand it **one adapter**, a *resolver*, that reads a user's roles and the permissions they grant from however your app stores them — a fixed catalog in code, or the DB-backed tables `npx warlock add access` ejects. Then `can(user, "orders.update")` and `gate("orders.update")` just work. The two ideas inside are **permissions** (RBAC grants) and **policies** (ABAC conditions) — which is exactly why it's called `access`, not either half.

## When to reach for it

You're on `@warlock.js/auth` and you want any of:

- A route gate that checks a permission, not just a user type.
- Roles that map to permission sets, with wildcards (`orders.*`).
- "Only their own order / only in their tenant" conditions.
- Per-tenant roles — a user who is `editor` in one organization and `viewer` in another.

If you only need "is this an admin", `authMiddleware("admin")` from `@warlock.js/auth` already covers that. Reach for `access` when the answer depends on a **permission** or a **specific resource**.

## The two-stage model

This is the one thing worth internalising up front:

- **Class-level** — _"can this user update orders at all?"_ No specific order involved. Use `gate("orders.update")` in middleware, or `can(user, "orders.update")` in code. Cheap, cached, runs before your controller.
- **Instance-level** — _"can they update **this** order?"_ Depends on the order (ownership, tenant, status). Use `authorize(user, "orders.update", { resource: order })` in your service, after you load the row. It runs the permission's **policy** on top of the grant.

A route gate is class-level; the per-record rule lives in the service. Keep them in their lanes and authorization stays simple.

## What it does NOT do

- **Authentication.** That's `@warlock.js/auth`; `access` reads `request.user`.
- **An admin UI.** The DB-backed resolver makes the role→permission catalog runtime-editable (it's the ejected `Role` table), but the screens to manage it are yours to build.
- **ReBAC graphs or row-level query scoping.** A policy covers the common "own resource" case; graph-scale relationships are out of scope.

## How the docs are organized

- **Getting started** — install, configure, run your first check.
- **Essentials** — RBAC vs ABAC, and the resolver seam.
- **Guides** — task how-tos (check, policy, roles, custom resolver).
- **Recipes** — real-world, copy-paste patterns.
- **Reference** — the exact exported surface.

Start with [Installation](./02-installation.mdx).
