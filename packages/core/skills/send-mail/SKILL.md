---
name: send-mail
description: 'Send transactional email — `Mail` fluent builder, `sendMail()` direct call, React Email components. Test mode auto-captures into an in-memory mailbox; dev mode logs. Triggers: `Mail.to`, `sendMail`, `setMailMode`, `mailEvents`, `assertMailSent`, `getTestMailbox`, `wasMailSentTo`, `closeAllMailers`; "send a transactional email", "build a React Email template", "configure SMTP or SES", "assert an email was sent in tests"; typical import `import { Mail, sendMail } from "@warlock.js/core"`. Skip: per-config wiring — `@warlock.js/core/configure-app/SKILL.md`; layered service patterns — `@warlock.js/core/warlock-conventions/SKILL.md`; competing libs `nodemailer` direct, `@sendgrid/mail`, `resend`, `mailgun.js`.'
---

# Warlock — send a mail

Two APIs over the same engine. The fluent `Mail` builder reads top-to-bottom in services; the functional `sendMail({...})` is best when the payload is already built. Both run through the same render → normalize → pool → transport pipeline, with a mode switch (`production` / `development` / `test`) deciding whether to actually send, log, or capture.

## The shape

```ts
import { Mail } from "@warlock.js/core";

await Mail.to("user@example.com")
  .subject("Welcome!")
  .text("Thanks for joining.")
  .send();
```

Or:

```ts
import { sendMail } from "@warlock.js/core";

await sendMail({
  to: "user@example.com",
  subject: "Welcome!",
  text: "Thanks for joining.",
});
```

`send()` / `sendMail()` resolves to a `MailResult` (`{ success, messageId, accepted, rejected, response, envelope }`).

## Configuration

`src/config/mail.ts` is the global default config — a single `MailConfigurations` object:

```ts title="src/config/mail.ts"
import type { MailConfigurations } from "@warlock.js/core";
import { env } from "@warlock.js/core";

const mailConfigurations: MailConfigurations = {
  host: env("MAIL_HOST"),
  username: env("MAIL_USERNAME"),
  password: env("MAIL_PASSWORD"),
  port: env("MAIL_PORT"),
  secure: env("MAIL_SECURE"),
  from: {
    name: env("MAIL_FROM_NAME"),
    address: env("MAIL_FROM_ADDRESS"),
  },
};

export default mailConfigurations;
```

For named mailers (multi-provider apps), export a `MailersConfig` instead:

```ts
const config: MailersConfig = {
  default: { host: "smtp.sendgrid.net", port: 587, username: "apikey", password: env("SENDGRID_KEY") },
  mailers: {
    marketing: { host: "smtp.mailchimp.com", port: 587, username: env("MC_USER"), password: env("MC_PASS") },
    transactional: { host: "smtp.postmark.com", port: 587, username: env("PM_USER"), password: env("PM_PASS") },
  },
};
```

Then route a single mail through a specific mailer:

```ts
await Mail.mailer("marketing").to("user@example.com").subject("Promo").html(...).send();
```

For AWS SES, set `driver: "ses"`:

```ts
const config: MailConfigurations = {
  driver: "ses",
  accessKeyId: env("AWS_ACCESS_KEY_ID"),
  secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
  region: env("AWS_REGION"),
  from: { name: "My App", address: "noreply@app.com" },
};
```

Requires `@aws-sdk/client-sesv2` installed (`yarn add @aws-sdk/client-sesv2`).

## Mail modes

The mail pipeline switches behavior on a global mode:

```ts
import { setMailMode } from "@warlock.js/core";

setMailMode("production");   // actually send (default)
setMailMode("development");  // log subject + recipient, no send
setMailMode("test");         // capture to test mailbox, no send
```

Production sends. Development logs and returns a fake-success `MailResult`. Test captures every call into an in-memory mailbox (cleared between tests) and returns success — handy for asserting "the welcome email got sent" without hitting SMTP.

## The fluent builder — `Mail`

`Mail` is built per call. `to(...)` / `config(...)` / `mailer(...)` start a new builder; each setter returns `this`. The final `.send()` validates and pipes through `sendMail()`.

### Recipients + addressing

```ts
await Mail.to("a@example.com")
  .to(["a@example.com", "b@example.com"])      // override
  .cc("manager@example.com")
  .bcc("audit@example.com")
  .replyTo("support@example.com")
  .from({ name: "Support", address: "support@example.com" })
  .subject("Subject line")
  .send();
```

`from` overrides the configured default. Pass a plain string or `{ name, address }`.

### Content (pick one — `text`, `html`, or `component`)

```ts
// Plain text
Mail.to("u@e.com").subject("Plain").text("Hi.").send();

// HTML
Mail.to("u@e.com").subject("Html").html("<p>Hi.</p>").send();

// React component (renders via @react-email/render if installed, fallback to renderToStaticMarkup)
Mail.to("u@e.com").subject("React").component(<WelcomeEmail name="Hasan" />).send();
```

`.send()` throws if all three are missing.

### Attachments

```ts
await Mail.to("u@e.com")
  .subject("Invoice")
  .html("<p>See attached.</p>")
  .attach(pdfBuffer, "invoice.pdf", "application/pdf")
  .attachFile("/abs/path/to/terms.pdf", "terms.pdf")
  .send();
```

`attach(content, filename, contentType?)` for buffers/strings; `attachFile(path, filename?, contentType?)` reads from disk at send time. `attachments([...])` accepts a pre-built array.

### Other knobs

| Method                                | Purpose                                       |
| ------------------------------------- | --------------------------------------------- |
| `.priority("high" \| "normal" \| "low")` | priority header                            |
| `.headers({ "X-Foo": "bar" })`        | replace custom headers                        |
| `.header("X-Foo", "bar")`             | add one header                                |
| `.tags(["welcome"])` / `.tag("transactional")` | categorization tags                  |
| `.correlationId("req-123")`           | tracking id (logged with sends)               |
| `.config(MailConfigurations)`         | one-off override of the global config         |
| `.mailer("marketing")`                | route via a named mailer from config          |

### Per-mail event handlers

The builder exposes four lifecycle handlers:

```ts
await Mail.to("u@e.com")
  .subject("…")
  .text("…")
  .beforeSending((mail) => {
    // mutate `mail` or return false to cancel
  })
  .onSent((mail, result, error) => {})    // always fires after attempt
  .onSuccess((mail, result) => {})        // only on success
  .onError((mail, error) => {})           // only on failure
  .send();
```

Returning `false` from `beforeSending` cancels the send and resolves with `success: false`.

## The functional API — `sendMail`

Same options as the builder, passed as one object:

```ts
import { sendMail } from "@warlock.js/core";

await sendMail({
  to: "user@example.com",
  cc: ["manager@example.com"],
  subject: "Welcome",
  component: <WelcomeEmail name="Hasan" />,
  config: tenant.mailSettings,    // multi-tenant override
  tags: ["welcome"],
  onSuccess: (mail, result) => {},
});
```

Use this when the payload is already an object — e.g. inside a queue worker iterating over a list. Both APIs share the same `MailOptions` shape.

## React templates

Pass a React element directly via `.component(<Template/>)` (builder) or `component:` (sendMail). The renderer:

1. Tries `@react-email/render` (full React Email pipeline — install with `warlock add react-email`, which also drops a sample `emails/welcome-email.tsx` and patches `tsconfig.json` to include it).
2. Falls back to `react-dom/server`'s `renderToStaticMarkup` wrapped in a minimal `<html>` shell.

```tsx
import { Html, Heading, Text } from "@react-email/components";

export function WelcomeEmail({ name }: { name: string }) {
  return (
    <Html>
      <Heading>Welcome, {name}</Heading>
      <Text>Thanks for joining.</Text>
    </Html>
  );
}
```

The renderer takes care of inlining styles and building the HTML page. You don't need to add a `<head>` or wrap in `<Mjml>`.

## Global event hooks

For app-wide observability (metrics, logging, audit), subscribe to global mail events:

```ts
import { mailEvents } from "@warlock.js/core";

mailEvents.onSuccess((mail, result) => {
  console.log("mail sent", result.messageId);
});

mailEvents.onError((mail, error) => {
  console.error("mail failed", error.code, error.message);
});

mailEvents.onBeforeSending((mail) => {
  // return false to cancel globally
});
```

Global hooks fire for **every** mail. Per-mail handlers from the builder / `sendMail` fire only for that one send.

For correlated tracking of a specific mail, generate an id and subscribe by id:

```ts
import { generateMailId, mailEvents, sendMail } from "@warlock.js/core";

const mailId = generateMailId();

mailEvents.onMailSuccess(mailId, (mail, result) => {
  // fires only for this specific mail
});

await sendMail({ id: mailId, to: "u@e.com", subject: "…", text: "…" });
```

## Testing — the test mailbox

In test mode, every send is captured instead of dispatched. Helpers live as named exports — there is no `testMailbox` object:

```ts
import {
  setMailMode,
  clearTestMailbox,
  getTestMailbox,
  getLastMail,
  findMailsTo,
  findMailsBySubject,
  wasMailSentTo,
  wasMailSentWithSubject,
  getMailboxSize,
  assertMailSent,
  assertMailCount,
} from "@warlock.js/core";

beforeEach(() => {
  setMailMode("test");
  clearTestMailbox();
});

it("sends a welcome email on signup", async () => {
  await signupUserService({ email: "u@e.com" });

  expect(wasMailSentTo("u@e.com")).toBe(true);
  expect(wasMailSentWithSubject("Welcome!")).toBe(true);

  const mail = assertMailSent((m) => m.options.to === "u@e.com");
  expect(mail.options.subject).toBe("Welcome!");
});
```

Captured mail shape:

```ts
type CapturedMail = {
  options: MailOptions;       // original payload
  normalized: NormalizedMail; // post-normalization (arrays, resolved from)
  timestamp: Date;
  result?: MailResult;        // in test mode, always success
  error?: MailError;
};
```

`assertMailSent(predicate)` throws if no mail matches. `assertMailCount(n)` throws if the captured count isn't `n`.

## Connection pooling

Transports (one per unique config hash) are cached in an in-process pool. The first send creates a connection; subsequent sends reuse it. On shutdown:

```ts
import { closeAllMailers } from "@warlock.js/core";

closeAllMailers();
```

`closeAllMailers()` is synchronous (returns `void`) — it closes every transport in the pool and clears it. You rarely call this manually — the framework closes the pool on shutdown.

## Common patterns

### Welcome email after signup

```ts
import { Mail } from "@warlock.js/core";
import { WelcomeEmail } from "../emails/welcome.email";

export async function sendWelcomeEmail(user: User) {
  return Mail.to(user.email)
    .subject(`Welcome, ${user.name}`)
    .component(<WelcomeEmail name={user.name} />)
    .tags(["welcome", "transactional"])
    .send();
}
```

### Per-tenant SMTP

```ts
await Mail.config(tenant.mailSettings)
  .to(invitation.email)
  .subject(`You've been invited to ${tenant.name}`)
  .text(`Click here to accept: ${url}`)
  .send();
```

### Cancel via beforeSending (e.g. user has opted out)

```ts
await Mail.to(user.email)
  .subject("Newsletter")
  .html(content)
  .beforeSending(async (mail) => {
    if (await hasOptedOut(user.id)) return false;
  })
  .send();
```

## Gotchas

- **`.send()` validates** — `to`, `subject`, and at least one of `text`/`html`/`component` are required. Missing any throws synchronously.
- **`@react-email/render` is optional.** Without it you get the basic fallback (inline styles, no MSO conditionals). Install it for production-quality HTML.
- **`nodemailer` is loaded lazily** at import time. If you see `nodemailer is not installed` errors, run `warlock add mail` (or `yarn add nodemailer`).
- **`secure: true` requires port 465.** For port 587 use `secure: false` and `tls: true` (STARTTLS).
- **Test mode is process-global.** Set it in `beforeAll`/`beforeEach`; reset with `setMailMode("production")` (or rely on test runner isolation).
- **Per-mail handlers don't replace global ones** — both fire. Avoid double-counting metrics.

## See also

- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `src/config/mail.ts` shape and `env()` patterns.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — where mail-sending services live.
