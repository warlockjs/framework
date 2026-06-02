//#region ../../@warlock.js/core/src/mail/test-mailbox.ts
/**
* Test mailbox for capturing sent emails in test mode
*/
let testMailbox = [];
/**
* Add a mail to the test mailbox
*/
function captureMail(mail) {
	testMailbox.push(mail);
}
/**
* Get all captured mails
*/
function getTestMailbox() {
	return [...testMailbox];
}
/**
* Get the last captured mail
*/
function getLastMail() {
	return testMailbox[testMailbox.length - 1];
}
/**
* Find mails by recipient
*/
function findMailsTo(email) {
	return testMailbox.filter((mail) => {
		return (Array.isArray(mail.options.to) ? mail.options.to : [mail.options.to]).includes(email);
	});
}
/**
* Find mails by subject (partial match)
*/
function findMailsBySubject(subject) {
	return testMailbox.filter((mail) => mail.options.subject.includes(subject));
}
/**
* Check if a mail was sent to a specific recipient
*/
function wasMailSentTo(email) {
	return findMailsTo(email).length > 0;
}
/**
* Check if a mail with specific subject was sent
*/
function wasMailSentWithSubject(subject) {
	return testMailbox.some((mail) => mail.options.subject === subject);
}
/**
* Get mailbox size
*/
function getMailboxSize() {
	return testMailbox.length;
}
/**
* Clear the test mailbox
*/
function clearTestMailbox() {
	testMailbox = [];
}
/**
* Assert helper for testing
*/
function assertMailSent(predicate) {
	const mail = testMailbox.find(predicate);
	if (!mail) throw new Error("No mail matching the predicate was found in the test mailbox");
	return mail;
}
/**
* Assert that a specific number of mails were sent
*/
function assertMailCount(count) {
	if (testMailbox.length !== count) throw new Error(`Expected ${count} mails to be sent, but found ${testMailbox.length}`);
}
//#endregion
export { assertMailCount, assertMailSent, captureMail, clearTestMailbox, findMailsBySubject, findMailsTo, getLastMail, getMailboxSize, getTestMailbox, wasMailSentTo, wasMailSentWithSubject };

//# sourceMappingURL=test-mailbox.mjs.map