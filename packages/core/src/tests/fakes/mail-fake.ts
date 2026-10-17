import { getExplicitMailMode, resetMailMode, setMailMode } from "../../mail/config";
import { clearTestMailbox, getTestMailbox } from "../../mail/test-mailbox";
import type { CapturedMail, MailMode } from "../../mail/types";
import { FakeAssertionError, describeRecorded } from "./fake-assertion-error";

/**
 * Which mails an assertion is about: a predicate, or fields that must all
 * match. `to` matches any recipient (to, cc or bcc); `subject` is an exact
 * string or a pattern.
 */
export type MailMatcher =
  | ((mail: CapturedMail) => boolean)
  | {
      to?: string;
      subject?: string | RegExp;
      from?: string;
      /** Text the HTML or plain-text body contains. */
      contains?: string;
    };

function fromAddress(mail: CapturedMail): string {
  const from = mail.normalized?.from ?? mail.options.from;

  if (!from) return "";

  return typeof from === "string" ? from : from.address;
}

function recipients(mail: CapturedMail): string[] {
  const list = (value: string | string[] | undefined) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value];

  return [...list(mail.options.to), ...list(mail.options.cc), ...list(mail.options.bcc)];
}

function matches(mail: CapturedMail, matcher: MailMatcher | undefined): boolean {
  if (matcher === undefined) return true;
  if (typeof matcher === "function") return matcher(mail);

  if (matcher.to !== undefined && !recipients(mail).includes(matcher.to)) return false;

  if (matcher.subject !== undefined) {
    const subject = mail.options.subject;
    const ok =
      typeof matcher.subject === "string"
        ? subject === matcher.subject
        : matcher.subject.test(subject);

    if (!ok) return false;
  }

  if (matcher.from !== undefined && fromAddress(mail) !== matcher.from) return false;

  if (matcher.contains !== undefined) {
    const body = `${mail.normalized?.html ?? mail.options.html ?? ""}\n${mail.normalized?.text ?? mail.options.text ?? ""}`;

    if (!body.includes(matcher.contains)) return false;
  }

  return true;
}

function describeMatcher(matcher: MailMatcher | undefined): string {
  if (matcher === undefined) return "any mail";
  if (typeof matcher === "function") return "a mail matching the predicate";

  return `a mail with ${JSON.stringify(matcher, (_key, value: unknown) =>
    value instanceof RegExp ? String(value) : value,
  )}`;
}

function describeMail(mail: CapturedMail): string {
  return `to ${recipients(mail).join(", ") || "(nobody)"} — "${mail.options.subject}"`;
}

let previousMode: MailMode | undefined;
let installed = false;

/**
 * Captures every `sendMail()` / `Mail` send instead of delivering it.
 *
 * Installed by default in the test environment (see `installTestFakes`). It
 * switches the mailer to its `test` mode, which records into the test mailbox
 * and never opens an SMTP or SES connection.
 *
 * @example
 * await registerUser({ email: "ada@example.test" });
 *
 * mailFake.assertSent({ to: "ada@example.test", subject: /welcome/i });
 * mailFake.assertSentCount(1);
 */
export const mailFake = {
  /** Start capturing (idempotent). Clears anything captured before. */
  install(): void {
    if (!installed) {
      previousMode = getExplicitMailMode();
      installed = true;
    }

    setMailMode("test");
    clearTestMailbox();
  },

  /** Stop capturing and restore the mode that was in force before. */
  restore(): void {
    if (!installed) return;

    if (previousMode === undefined) resetMailMode();
    else setMailMode(previousMode);

    clearTestMailbox();
    previousMode = undefined;
    installed = false;
  },

  /** Whether the fake is installed. */
  isInstalled(): boolean {
    return installed;
  },

  /** Forget captured mails, e.g. in `beforeEach`. */
  clear(): void {
    clearTestMailbox();
  },

  /** The captured mails, oldest first, optionally filtered. */
  sent(matcher?: MailMatcher): CapturedMail[] {
    return getTestMailbox().filter((mail) => matches(mail, matcher));
  },

  /** Assert at least one matching mail was sent; returns the first. */
  assertSent(matcher?: MailMatcher): CapturedMail {
    const found = mailFake.sent(matcher)[0];

    if (!found) {
      throw new FakeAssertionError(
        `Expected ${describeMatcher(matcher)} to be sent. ${describeRecorded(getTestMailbox(), describeMail, "sent")}`,
      );
    }

    return found;
  },

  /** Assert no matching mail was sent. */
  assertNotSent(matcher?: MailMatcher): void {
    const found = mailFake.sent(matcher);

    if (found.length > 0) {
      throw new FakeAssertionError(
        `Expected ${describeMatcher(matcher)} not to be sent. ${describeRecorded(found, describeMail, "sent")}`,
      );
    }
  },

  /** Assert exactly `count` matching mails were sent. */
  assertSentCount(count: number, matcher?: MailMatcher): void {
    const found = mailFake.sent(matcher);

    if (found.length !== count) {
      throw new FakeAssertionError(
        `Expected ${count} × ${describeMatcher(matcher)}, found ${found.length}. ${describeRecorded(getTestMailbox(), describeMail, "sent")}`,
      );
    }
  },

  /** Assert nothing at all was sent. */
  assertNothingSent(): void {
    mailFake.assertNotSent();
  },
};
