import { CapturedMail } from "./types.mjs";

//#region ../../@warlock.js/core/src/mail/test-mailbox.d.ts
/**
 * Add a mail to the test mailbox
 */
declare function captureMail(mail: CapturedMail): void;
/**
 * Get all captured mails
 */
declare function getTestMailbox(): CapturedMail[];
/**
 * Get the last captured mail
 */
declare function getLastMail(): CapturedMail | undefined;
/**
 * Find mails by recipient
 */
declare function findMailsTo(email: string): CapturedMail[];
/**
 * Find mails by subject (partial match)
 */
declare function findMailsBySubject(subject: string): CapturedMail[];
/**
 * Check if a mail was sent to a specific recipient
 */
declare function wasMailSentTo(email: string): boolean;
/**
 * Check if a mail with specific subject was sent
 */
declare function wasMailSentWithSubject(subject: string): boolean;
/**
 * Get mailbox size
 */
declare function getMailboxSize(): number;
/**
 * Clear the test mailbox
 */
declare function clearTestMailbox(): void;
/**
 * Assert helper for testing
 */
declare function assertMailSent(predicate: (mail: CapturedMail) => boolean): CapturedMail;
/**
 * Assert that a specific number of mails were sent
 */
declare function assertMailCount(count: number): void;
//#endregion
export { assertMailCount, assertMailSent, captureMail, clearTestMailbox, findMailsBySubject, findMailsTo, getLastMail, getMailboxSize, getTestMailbox, wasMailSentTo, wasMailSentWithSubject };
//# sourceMappingURL=test-mailbox.d.mts.map