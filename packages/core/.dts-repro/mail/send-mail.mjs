import { isDevelopmentMode, isTestMode, resolveMailConfig } from "./config.mjs";
import { generateMailId, mailEvents } from "./events.mjs";
import { getMailer } from "./mailer-pool.mjs";
import { renderReactMail } from "./react-mail.mjs";
import { captureMail } from "./test-mailbox.mjs";
import { MailError } from "./types.mjs";
import { log } from "@warlock.js/logger";
import { readFile } from "node:fs/promises";
//#region ../../@warlock.js/core/src/mail/send-mail.ts
/**
* Normalize email address to string
*/
function addressToString(address) {
	if (typeof address === "string") return address;
	return `"${address.name}" <${address.address}>`;
}
/**
* Normalize recipients to array
*/
function normalizeRecipients(recipients) {
	if (!recipients) return [];
	return Array.isArray(recipients) ? recipients : [recipients];
}
/**
* Map priority to nodemailer format
*/
function mapPriority(priority) {
	return priority;
}
/**
* Normalize mail options to internal format
*/
function normalizeMail(options) {
	const config = resolveMailConfig(options);
	return {
		to: normalizeRecipients(options.to),
		cc: normalizeRecipients(options.cc),
		bcc: normalizeRecipients(options.bcc),
		replyTo: options.replyTo,
		from: options.from || config.from || {
			name: "No Reply",
			address: "noreply@localhost"
		},
		subject: options.subject,
		html: options.html,
		text: options.text,
		attachments: options.attachments || [],
		priority: options.priority || "normal",
		headers: options.headers || {},
		tags: options.tags || [],
		correlationId: options.correlationId,
		config
	};
}
/**
* Resolve attachment - read file if path is provided
*/
async function resolveAttachment(attachment) {
	if (attachment.path) try {
		const content = await readFile(attachment.path);
		return {
			filename: attachment.filename,
			content,
			contentType: attachment.contentType,
			encoding: attachment.encoding,
			cid: attachment.cid
		};
	} catch (error) {
		throw new MailError(`Failed to read attachment file "${attachment.path}": ${error instanceof Error ? error.message : "Unknown error"}`, "CONFIG_ERROR", error instanceof Error ? error : void 0);
	}
	return {
		filename: attachment.filename,
		content: attachment.content,
		contentType: attachment.contentType,
		encoding: attachment.encoding,
		cid: attachment.cid
	};
}
/**
* Build nodemailer options from normalized mail
*/
async function buildNodemailerOptions(normalized) {
	const options = {
		to: normalized.to,
		from: addressToString(normalized.from),
		subject: normalized.subject,
		priority: mapPriority(normalized.priority)
	};
	if (normalized.cc.length > 0) options.cc = normalized.cc;
	if (normalized.bcc.length > 0) options.bcc = normalized.bcc;
	if (normalized.replyTo) options.replyTo = normalized.replyTo;
	if (normalized.html) options.html = normalized.html;
	if (normalized.text) options.text = normalized.text;
	if (normalized.attachments.length > 0) options.attachments = (await Promise.all(normalized.attachments.map((att) => resolveAttachment(att)))).map((att) => ({
		filename: att.filename,
		content: att.content,
		contentType: att.contentType,
		encoding: att.encoding,
		cid: att.cid
	}));
	if (Object.keys(normalized.headers).length > 0) options.headers = normalized.headers;
	return options;
}
/**
* Run per-mail event handler
*/
async function runMailEvent(handler, ...args) {
	if (!handler) return;
	try {
		return await handler(...args);
	} catch (error) {
		log.error("mail", "event", `Per-mail event handler error: ${error}`);
		return;
	}
}
/**
* Trigger both global and mail-specific events
*/
async function triggerEvents(mailId, event, ...args) {
	try {
		const globalEventName = event === "beforeSending" ? "BEFORE_SENDING" : event === "sent" ? "SENT" : event === "success" ? "SUCCESS" : "ERROR";
		const globalResults = await mailEvents.trigger(globalEventName, ...args);
		const specificResults = await mailEvents.triggerForMail(mailId, event, ...args);
		return [...globalResults || [], ...specificResults || []];
	} catch (error) {
		log.error("mail", "event", `Event handler error: ${error}`);
		return [];
	}
}
/**
* Send an email
*
* @param options Mail options including recipients, content, and configuration
* @returns Result containing success status, message ID, and accepted/rejected recipients
*
* @example
* ```typescript
* // Basic usage
* await sendMail({
*   to: "user@example.com",
*   subject: "Hello",
*   html: "<p>World</p>",
* });
*
* // With React component
* await sendMail({
*   to: "user@example.com",
*   subject: "Welcome!",
*   component: <WelcomeEmail name="John" />,
* });
*
* // Track specific mail with events
* const mailId = generateMailId();
* mailEvents.onMailSuccess(mailId, (mail, result) => {
*   console.log("This specific mail was sent!");
* });
* await sendMail({ id: mailId, to: "...", subject: "...", html: "..." });
* ```
*/
async function sendMail(options) {
	const mailId = options.id || generateMailId();
	if (options.component) try {
		options.html = await renderReactMail(options.component);
	} catch (error) {
		const mailError = new MailError(`Failed to render React component: ${error instanceof Error ? error.message : "Unknown error"}`, "RENDER_ERROR", error instanceof Error ? error : void 0);
		await runMailEvent(options.onError, options, mailError);
		await triggerEvents(mailId, "error", options, mailError);
		throw mailError;
	}
	const normalized = normalizeMail(options);
	const driver = normalized.config.driver || "smtp";
	const beforeResult = await runMailEvent(options.beforeSending, options);
	const globalBeforeResults = await triggerEvents(mailId, "beforeSending", options);
	if (beforeResult === false || globalBeforeResults.some((r) => r === false)) {
		log.info(`mail.${driver}`, "cancelled", "Mail sending cancelled by beforeSending event");
		return {
			success: false,
			accepted: [],
			rejected: normalized.to,
			response: "Cancelled by beforeSending event"
		};
	}
	if (isTestMode()) {
		log.info(`mail.${driver}`, "test", `[TEST MODE] Captured mail to: ${normalized.to.join(", ")}`);
		const result = {
			success: true,
			messageId: `test-${mailId}@localhost`,
			accepted: normalized.to,
			rejected: [],
			response: "Test mode - mail captured"
		};
		captureMail({
			options,
			normalized,
			timestamp: /* @__PURE__ */ new Date(),
			result
		});
		await runMailEvent(options.onSuccess, options, result);
		await triggerEvents(mailId, "success", options, result);
		await runMailEvent(options.onSent, options, result, null);
		await triggerEvents(mailId, "sent", options, result, null);
		return result;
	}
	if (isDevelopmentMode()) {
		log.info(`mail.${driver}`, "dev", `[DEV MODE] Would send mail to: ${normalized.to.join(", ")}`);
		log.info(`mail.${driver}`, "dev", `Subject: ${normalized.subject}`);
		if (normalized.html) log.info(`mail.${driver}`, "dev", `HTML length: ${normalized.html.length} chars`);
		const result = {
			success: true,
			messageId: `dev-${mailId}@localhost`,
			accepted: normalized.to,
			rejected: [],
			response: "Development mode - mail logged"
		};
		await runMailEvent(options.onSuccess, options, result);
		await triggerEvents(mailId, "success", options, result);
		await runMailEvent(options.onSent, options, result, null);
		await triggerEvents(mailId, "sent", options, result, null);
		return result;
	}
	try {
		const mailer = await getMailer(resolveMailConfig(options));
		const nodemailerOptions = await buildNodemailerOptions(normalized);
		log.info(`mail.${driver}`, "send", `Sending mail to: ${normalized.to.join(", ")}`);
		const output = await mailer.sendMail(nodemailerOptions);
		const accepted = output.accepted || (output.messageId ? normalized.to : []);
		const rejected = output.rejected || [];
		const result = {
			success: accepted.length > 0,
			messageId: output.messageId,
			accepted,
			rejected,
			response: output.response,
			envelope: output.envelope
		};
		if (result.success) {
			log.success(`mail.${driver}`, "sent", `Mail sent successfully (ID: ${result.messageId})`);
			await runMailEvent(options.onSuccess, options, result);
			await triggerEvents(mailId, "success", options, result);
		} else log.warn(`mail.${driver}`, "partial", `Mail partially rejected: ${rejected.join(", ")}`);
		await runMailEvent(options.onSent, options, result, null);
		await triggerEvents(mailId, "sent", options, result, null);
		return result;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		let code = "UNKNOWN";
		if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("ENOTFOUND")) code = "CONNECTION_ERROR";
		else if (errorMessage.includes("authentication") || errorMessage.includes("auth")) code = "AUTH_ERROR";
		else if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) code = "TIMEOUT";
		else if (errorMessage.includes("rate") || errorMessage.includes("limit")) code = "RATE_LIMIT";
		const mailError = new MailError(`Failed to send mail: ${errorMessage}`, code, error instanceof Error ? error : void 0);
		log.error(`mail.${driver}`, "error", mailError.message);
		await runMailEvent(options.onError, options, mailError);
		await triggerEvents(mailId, "error", options, mailError);
		await runMailEvent(options.onSent, options, null, mailError);
		await triggerEvents(mailId, "sent", options, null, mailError);
		throw mailError;
	}
}
//#endregion
export { sendMail };

//# sourceMappingURL=send-mail.mjs.map