import { Random } from "@mongez/reinforcements";
import events from "@mongez/events";
//#region ../../@warlock.js/core/src/mail/events.ts
/**
* Generate a unique mail ID for event namespacing
*/
function generateMailId() {
	return "M" + Random.int(32);
}
/**
* Mail event names (global events)
*/
const MAIL_EVENTS = {
	BEFORE_SENDING: "mail.beforeSending",
	SENT: "mail.sent",
	SUCCESS: "mail.success",
	ERROR: "mail.error"
};
/**
* Get namespaced event name for a specific mail
* @param mailId Unique mail identifier
* @param event Event type
* @returns Namespaced event name (e.g., "mail.abc123.success")
*/
function getMailEventName(mailId, event) {
	return `mail.${mailId}.${event}`;
}
/**
* Mail events wrapper
*
* Supports two event patterns:
* 1. Global events: `mail.success` - fires for ALL emails
* 2. Specific events: `mail.$mailId.success` - fires for ONE email
*
* ## Usage
*
* ```typescript
* // Global listener - all emails
* mailEvents.onSuccess((mail, result) => {
*   console.log("Any mail sent:", result.messageId);
* });
*
* // Specific listener - one email by ID
* const mailId = generateMailId();
* mailEvents.onMailSuccess(mailId, (mail, result) => {
*   console.log("This specific mail sent:", result.messageId);
* });
*
* await sendMail({
*   id: mailId, // Use the same ID
*   to: "user@example.com",
*   subject: "Hello",
*   html: "<p>World</p>",
* });
* ```
*/
const mailEvents = {
	/**
	* Trigger a global mail event
	*/
	trigger: (eventName, ...args) => {
		return events.trigger(MAIL_EVENTS[eventName], ...args);
	},
	/**
	* Trigger a specific mail event (by mail ID)
	*/
	triggerForMail: (mailId, event, ...args) => {
		return events.trigger(getMailEventName(mailId, event), ...args);
	},
	/**
	* Subscribe to global mail events
	*/
	on: (eventName, callback) => {
		return events.subscribe(MAIL_EVENTS[eventName], callback);
	},
	/**
	* Subscribe to beforeSending event (all mails)
	*/
	onBeforeSending: (callback) => {
		return events.subscribe(MAIL_EVENTS.BEFORE_SENDING, callback);
	},
	/**
	* Subscribe to sent event (all mails, after attempt)
	*/
	onSent: (callback) => {
		return events.subscribe(MAIL_EVENTS.SENT, callback);
	},
	/**
	* Subscribe to success event (all mails)
	*/
	onSuccess: (callback) => {
		return events.subscribe(MAIL_EVENTS.SUCCESS, callback);
	},
	/**
	* Subscribe to error event (all mails)
	*/
	onError: (callback) => {
		return events.subscribe(MAIL_EVENTS.ERROR, callback);
	},
	/**
	* Subscribe to beforeSending event for a specific mail
	*/
	onMailBeforeSending: (mailId, callback) => {
		return events.subscribe(getMailEventName(mailId, "beforeSending"), callback);
	},
	/**
	* Subscribe to sent event for a specific mail
	*/
	onMailSent: (mailId, callback) => {
		return events.subscribe(getMailEventName(mailId, "sent"), callback);
	},
	/**
	* Subscribe to success event for a specific mail
	*/
	onMailSuccess: (mailId, callback) => {
		return events.subscribe(getMailEventName(mailId, "success"), callback);
	},
	/**
	* Subscribe to error event for a specific mail
	*/
	onMailError: (mailId, callback) => {
		return events.subscribe(getMailEventName(mailId, "error"), callback);
	}
};
//#endregion
export { MAIL_EVENTS, generateMailId, getMailEventName, mailEvents };

//# sourceMappingURL=events.mjs.map