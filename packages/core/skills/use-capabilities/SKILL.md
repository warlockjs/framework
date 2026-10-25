---
name: use-capabilities
description: 'Break an import cycle or let one module plug into another with a typed, discoverable slot: `defineCapability<T>(name, { description, required })` declares it, `provideCapability(capability, implementation)` fills it from a module that loads at boot, `useCapability(capability)` reads it (throws `WL2008` when nothing provided it), `hasCapability` and `listCapabilities` inspect it. `warlock inspect --section wiring` lists each slot with its provider and consumers, and `warlock doctor` warns when a required one has no provider. Triggers: `defineCapability`, `provideCapability`, `useCapability`, `hasCapability`, `listCapabilities`, `Capability`, `CapabilityNotProvidedError`, `WL2008`, `inspect_wiring`, `--section wiring`; "circular import between modules", "module A needs module B but B imports A", "late-bound dependency", "register an implementation at boot", "plug-in point", "which file provides this", "what loads automatically". Skip: a service shared across the process by key — the `use-app-context` topic (`container`); events between modules — the `events` docs page; config values — the `configure-app` topic.'
---

# Warlock — capabilities

A capability is a named, typed slot. One module declares it, another fills it at boot, and any module reads it. Use it where a direct import would create a cycle (billing needs to send mail through a notifier that imports billing) or where a feature must plug into one that loads earlier. It replaces a module-level `let` that nobody can find: the framework knows every capability, who provides it and who reads it.

```ts
// src/app/billing/capabilities.ts: declare the slot, with the shape of what fills it
import { defineCapability } from "@warlock.js/core";

export type InvoiceMailer = { send(invoiceId: string): Promise<void> };

export const invoiceMailer = defineCapability<InvoiceMailer>("billing.invoiceMailer", {
  description: "Sends an invoice by email",
});
```

```ts
// src/app/notifications/main.ts: fill it at boot (main.ts, routes.ts and event files load automatically)
import { provideCapability } from "@warlock.js/core";
import { invoiceMailer } from "app/billing/capabilities";
import { sendInvoiceEmail } from "./services/send-invoice-email.service";

provideCapability(invoiceMailer, { send: sendInvoiceEmail });
```

```ts
// src/app/billing/services/send-invoice.service.ts: read it where it is needed
import { useCapability } from "@warlock.js/core";
import { invoiceMailer } from "../capabilities";

export async function sendInvoice(invoiceId: string) {
  await useCapability(invoiceMailer).send(invoiceId);
}
```

## The API

| Call                                          | Does                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `defineCapability<T>(name, options?)`         | Declares the slot. `options.description` is shown by `inspect`; `options.required` (default `true`) drives the doctor warning. Defining a name again updates it and keeps the provider. |
| `provideCapability(capability, implementation)` | Fills the slot. A second call replaces the first.                                                                       |
| `useCapability(capability)`                   | Returns the implementation. Throws `CapabilityNotProvidedError` (`WL2008`) when nothing provided it.                       |
| `hasCapability(capability)`                   | `true` when something provided it. Use it for an optional capability (`required: false`).                                  |
| `listCapabilities()`                          | Every defined capability with `provided`, `definedIn`, `providedBy` and `consumers` (absolute files, best effort).         |

Names are global strings: prefix them with the module (`billing.invoiceMailer`). The type parameter of `defineCapability` is checked at `provideCapability` and returned by `useCapability`; the name is not, so export the capability from the declaring module and import it, never re-declare the name.

## Providing at the right time

Provide from a file the framework loads on its own, so the slot is full before the first request: `main.ts`, `routes.ts`, an event file or a worker (`warlock inspect --section wiring` shows them in boot order). Do not provide inside a request handler. Do not read a capability at module scope in a file that loads before its provider; read it inside the function that needs it.

## Seeing and checking the wiring

```bash
warlock inspect --section wiring        # auto-loaded files in boot order, then the capability slots
warlock inspect --json --section wiring # the same as JSON (MCP tool: inspect_wiring)
warlock doctor                          # `capabilities` warns (WL2008) about a required slot with no provider
```

In tests, call `resetCapabilities()` between cases that define their own, and `provideCapability` a fake before the code under test runs.

## Gotchas

- `consumers` lists the files that read the capability while the app booted. A capability read only inside a request handler shows none until that handler runs.
- Mark an optional integration `required: false`, or `warlock doctor` warns about it on every run.
- A capability is a process-wide singleton, like the container. It is not per request; for per-request data use `request.locals` (the `use-request-locals` topic).
