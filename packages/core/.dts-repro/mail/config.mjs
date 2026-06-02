//#region ../../@warlock.js/core/src/mail/config.ts
/**
* Default mail configurations
*/
const defaultConfigurations = {
	secure: true,
	tls: true,
	driver: "smtp"
};
/**
* Current mail mode
*/
let currentMode = "production";
/**
* Registered mailers configuration
*/
let mailersConfig = {};
/**
* Set the mail mode
*
* @param mode "production" | "development" | "test"
*
* - **production**: Actually sends emails via SMTP
* - **development**: Logs emails to console without sending
* - **test**: Captures emails to test mailbox for assertions
*
* @example
* ```typescript
* // In test setup
* setMailMode("test");
*
* // In development
* setMailMode("development");
* ```
*/
function setMailMode(mode) {
	currentMode = mode;
}
/**
* Get the current mail mode
*/
function getMailMode() {
	return currentMode;
}
/**
* Check if in production mode
*/
function isProductionMode() {
	return currentMode === "production";
}
/**
* Check if in development mode
*/
function isDevelopmentMode() {
	return currentMode === "development";
}
/**
* Check if in test mode
*/
function isTestMode() {
	return currentMode === "test";
}
/**
* Set mail configurations
*
* Supports both simple config and named mailers.
*
* @example
* ```typescript
* // Simple config (sets as default)
* setMailConfigurations({
*   host: "smtp.gmail.com",
*   port: 587,
*   username: "...",
*   password: "...",
* });
*
* // Named mailers
* setMailConfigurations({
*   default: { host: "smtp.sendgrid.net", ... },
*   mailers: {
*     marketing: { host: "smtp.mailchimp.com", ... },
*     transactional: { host: "smtp.postmark.com", ... },
*   },
* });
* ```
*/
function setMailConfigurations(config) {
	if ("default" in config || "mailers" in config) mailersConfig = config;
	else mailersConfig = { default: config };
}
function getDefaultMailConfig() {
	const config = mailersConfig.default;
	if (!config) return {};
	if ("driver" in config && config.driver === "ses") return config;
	return {
		...defaultConfigurations,
		...config
	};
}
/**
* Get a named mailer configuration
*/
function getMailerConfig(name) {
	if (name === "default") return getDefaultMailConfig();
	const config = mailersConfig.mailers?.[name];
	if (!config) return;
	if ("driver" in config && config.driver === "ses") return config;
	return {
		...defaultConfigurations,
		...config
	};
}
/**
* Resolve configuration from options
* Priority: config > mailer > default
*/
function resolveMailConfig(options) {
	if (options.config) {
		if ("driver" in options.config && options.config.driver === "ses") return options.config;
		return {
			...defaultConfigurations,
			...options.config
		};
	}
	if (options.mailer) {
		const config = getMailerConfig(options.mailer);
		if (!config) throw new Error(`Mailer "${options.mailer}" not found in configuration`);
		return config;
	}
	return getDefaultMailConfig();
}
/**
* Reset all configurations (useful for testing)
*/
function resetMailConfig() {
	currentMode = "production";
	mailersConfig = {};
}
//#endregion
export { getDefaultMailConfig, getMailMode, getMailerConfig, isDevelopmentMode, isProductionMode, isTestMode, resetMailConfig, resolveMailConfig, setMailConfigurations, setMailMode };

//# sourceMappingURL=config.mjs.map