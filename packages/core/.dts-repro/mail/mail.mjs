import { sendMail } from "./send-mail.mjs";
//#region ../../@warlock.js/core/src/mail/mail.ts
/**
* Fluent Mail Builder
*
* Provides a chainable API for building and sending emails.
*
* @example
* ```typescript
* await Mail.to("user@example.com")
*   .subject("Welcome!")
*   .component(<WelcomeEmail name="John" />)
*   .send();
*
* // With attachments
* await Mail.to("user@example.com")
*   .cc("manager@example.com")
*   .subject("Invoice")
*   .component(<InvoiceEmail order={order} />)
*   .attach(pdfBuffer, "invoice.pdf")
*   .send();
*
* // Multi-tenant
* await Mail.config(tenant.mailSettings)
*   .to("user@example.com")
*   .subject("Hello")
*   .html("<p>World</p>")
*   .send();
* ```
*/
var Mail = class Mail {
	/**
	* Private constructor - use static factory methods
	*/
	constructor() {
		this.options = {};
	}
	/**
	* Create a new mail with recipient
	*/
	static to(recipient) {
		const mail = new Mail();
		mail.options.to = recipient;
		return mail;
	}
	/**
	* Create a new mail with custom configuration (multi-tenant)
	*/
	static config(config) {
		const mail = new Mail();
		mail.options.config = config;
		return mail;
	}
	/**
	* Create a new mail with named mailer
	*/
	static mailer(name) {
		const mail = new Mail();
		mail.options.mailer = name;
		return mail;
	}
	/**
	* Set recipient(s)
	*/
	to(recipient) {
		this.options.to = recipient;
		return this;
	}
	/**
	* Set CC recipient(s)
	*/
	cc(recipient) {
		this.options.cc = recipient;
		return this;
	}
	/**
	* Set BCC recipient(s)
	*/
	bcc(recipient) {
		this.options.bcc = recipient;
		return this;
	}
	/**
	* Set reply-to address
	*/
	replyTo(address) {
		this.options.replyTo = address;
		return this;
	}
	/**
	* Set from address
	*/
	from(address) {
		this.options.from = address;
		return this;
	}
	/**
	* Set subject
	*/
	subject(subject) {
		this.options.subject = subject;
		return this;
	}
	/**
	* Set HTML content
	*/
	html(content) {
		this.options.html = content;
		return this;
	}
	/**
	* Set plain text content
	*/
	text(content) {
		this.options.text = content;
		return this;
	}
	/**
	* Set React component as content
	*/
	component(element) {
		this.options.component = element;
		return this;
	}
	/**
	* Add attachment
	*/
	attach(content, filename, contentType) {
		if (!this.options.attachments) this.options.attachments = [];
		this.options.attachments.push({
			filename,
			content,
			contentType
		});
		return this;
	}
	/**
	* Add multiple attachments
	*/
	attachments(attachments) {
		this.options.attachments = [...this.options.attachments || [], ...attachments];
		return this;
	}
	/**
	* Attach a file by path
	*
	* The file will be read automatically when the email is sent.
	*
	* @param path Path to the file
	* @param filename Optional custom filename (defaults to basename of path)
	* @param contentType Optional MIME type
	*
	* @example
	* ```typescript
	* Mail.to("user@example.com")
	*   .subject("Invoice")
	*   .html("<p>Please see attached</p>")
	*   .attachFile("./invoices/2024-001.pdf")
	*   .attachFile("./terms.pdf", "terms-and-conditions.pdf")
	*   .send();
	* ```
	*/
	attachFile(path, filename, contentType) {
		if (!this.options.attachments) this.options.attachments = [];
		const resolvedFilename = filename || path.split(/[/\\]/).pop() || "attachment";
		this.options.attachments.push({
			path,
			filename: resolvedFilename,
			contentType
		});
		return this;
	}
	/**
	* Set priority
	*/
	priority(level) {
		this.options.priority = level;
		return this;
	}
	/**
	* Set custom headers
	*/
	headers(headers) {
		this.options.headers = {
			...this.options.headers,
			...headers
		};
		return this;
	}
	/**
	* Add a custom header
	*/
	header(name, value) {
		this.options.headers = {
			...this.options.headers,
			[name]: value
		};
		return this;
	}
	/**
	* Set tags for categorization
	*/
	tags(tags) {
		this.options.tags = tags;
		return this;
	}
	/**
	* Add a tag
	*/
	tag(tag) {
		this.options.tags = [...this.options.tags || [], tag];
		return this;
	}
	/**
	* Set correlation ID for tracking
	*/
	correlationId(id) {
		this.options.correlationId = id;
		return this;
	}
	/**
	* Set configuration (multi-tenant)
	*/
	withConfig(config) {
		this.options.config = config;
		return this;
	}
	/**
	* Set named mailer
	*/
	withMailer(name) {
		this.options.mailer = name;
		return this;
	}
	/**
	* Set beforeSending event handler
	*/
	beforeSending(handler) {
		this.options.beforeSending = handler;
		return this;
	}
	/**
	* Set onSent event handler
	*/
	onSent(handler) {
		this.options.onSent = handler;
		return this;
	}
	/**
	* Set onSuccess event handler
	*/
	onSuccess(handler) {
		this.options.onSuccess = handler;
		return this;
	}
	/**
	* Set onError event handler
	*/
	onError(handler) {
		this.options.onError = handler;
		return this;
	}
	/**
	* Get the built options (for debugging)
	*/
	getOptions() {
		return { ...this.options };
	}
	/**
	* Validate the mail before sending
	*/
	validate() {
		if (!this.options.to) throw new Error("Mail recipient (to) is required");
		if (!this.options.subject) throw new Error("Mail subject is required");
		if (!this.options.html && !this.options.text && !this.options.component) throw new Error("Mail content (html, text, or component) is required");
	}
	/**
	* Send the email
	*/
	async send() {
		this.validate();
		return sendMail(this.options);
	}
};
//#endregion
export { Mail };

//# sourceMappingURL=mail.mjs.map