---
title: "Capabilities"
description: Typed, named slots one module fills at boot and others read — the supported way to break an import cycle between modules. defineCapability, provideCapability, useCapability, the inspect wiring section and the doctor warning for a slot nobody provided.
sidebar:
  order: 14
  label: "Capabilities"
---

Two modules sometimes need each other: billing sends an invoice through a notifier, and the notifier imports billing's types. A direct import is a cycle. The usual escape is a variable in a third file that one module sets and the other reads, and it works until someone has to find out who sets it, or why it is empty.

A **capability** is that variable made visible. It has a name and a type, exactly one module declares it, another fills it at boot, and the framework keeps the list: `warlock inspect` shows each one with its provider and the files that read it, and `warlock doctor` warns when a required one was never filled.

## Declare, provide, use

```ts title="src/app/billing/capabilities.ts"
import { defineCapability } from "@warlock.js/core";

export type InvoiceMailer = { send(invoiceId: string): Promise<void> };

export const invoiceMailer = defineCapability<InvoiceMailer>("billing.invoiceMailer", {
  description: "Sends an invoice by email",
});
```

Provide it from a file the framework loads on its own, so the slot is full before the first request:

```ts title="src/app/notifications/main.ts"
import { provideCapability } from "@warlock.js/core";
import { invoiceMailer } from "app/billing/capabilities";
import { sendInvoiceEmail } from "./services/send-invoice-email.service";

provideCapability(invoiceMailer, { send: sendInvoiceEmail });
```

Read it in the function that needs it:

```ts title="src/app/billing/services/send-invoice.service.ts"
import { useCapability } from "@warlock.js/core";
import { invoiceMailer } from "../capabilities";

export async function sendInvoice(invoiceId: string) {
  await useCapability(invoiceMailer).send(invoiceId);
}
```

The type given to `defineCapability` is checked by `provideCapability` and returned by `useCapability`. Export the capability from the module that declares it and import it where it is used; do not repeat the name string elsewhere.

## The API

| Call                                            | What it does                                                                                                                                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineCapability<T>(name, options?)`           | Declares the slot. `options.description` is shown by `inspect`. `options.required` (default `true`) decides whether `doctor` warns about a missing provider. Defining the same name again (a hot reload) updates the declaration and keeps the provider. |
| `provideCapability(capability, implementation)` | Fills the slot; a second call replaces the first.                                                                                                                                                                                                        |
| `useCapability(capability)`                     | Returns the implementation, or throws `CapabilityNotProvidedError` (`WL2008`) naming the fix when nothing provided it.                                                                                                                                   |
| `hasCapability(capability)`                     | Whether something provided it; the way to use an optional capability.                                                                                                                                                                                    |
| `listCapabilities()`                            | Every capability with `provided`, `definedIn`, `providedBy` and `consumers`.                                                                                                                                                                             |

Capability names are process-wide strings, so prefix them with the module (`billing.invoiceMailer`).

## When to provide

Provide from `main.ts`, `routes.ts`, an event file or a worker: the files the framework imports at boot. Do not provide from inside a request handler, and do not read a capability at module scope in a file that loads before its provider. [`warlock inspect --section wiring`](../cli/inspect.md#wiring-what-loads-on-its-own) prints those files in boot order.

## Seeing and checking the wiring

```bash
warlock inspect --section wiring   # auto-loaded files in boot order, then every capability
warlock doctor                     # warns (WL2008) about a required capability nobody provided
```

The `inspect` entry for a capability carries `required`, `provided`, `definedIn`, `providedBy` and `consumers`. `consumers` are the files that read it while the app booted, so a capability read only inside a request handler shows none until that handler runs. In the MCP server the same data is the `inspect_wiring` tool.

A capability that is optional by design is defined with `{ required: false }`, so `doctor` stays quiet about it; guard its use with `hasCapability`.

## In tests

The registry is shared by the whole process. Call `resetCapabilities()` between cases that define their own capabilities, and `provideCapability` a fake before the code under test runs.

## Capabilities and the container

The [container](../architecture-concepts/container.md) stores services by string key for the framework's own use (`http.server`, `database.source`). A capability is the app-level counterpart: typed, declared in one place, listed by `inspect`, and checked by `doctor`. Use the container for what the framework registers; use a capability for a dependency between your own modules.
