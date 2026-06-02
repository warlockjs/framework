import "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";
import { setMailConfigurations } from "../mail/config.mjs";
import { closeAllMailers } from "../mail/mailer-pool.mjs";
import "../mail/index.mjs";
import baseConfig from "@mongez/config";
//#region ../../@warlock.js/core/src/connectors/mail-connector.ts
/**
* Mailer Connector
* Manages mailer lifecycle and ensures graceful pool shutdown
*/
var MailerConnector = class extends BaseConnector {
	constructor(..._args) {
		super(..._args);
		this.name = "mailer";
		this.priority = 1;
		this.lifecyclePhase = "early";
		this.watchedFiles = [
			".env",
			"src/config/mail.ts",
			"src/config/mail.tsx"
		];
	}
	/**
	* Initialize mailer configurations
	*/
	async start() {
		const mailConfig = baseConfig.get("mail");
		if (!mailConfig) return;
		try {
			setMailConfigurations(mailConfig);
			this.active = true;
		} catch (error) {
			console.error("Failed to initialize mailer:", error);
			throw error;
		}
	}
	/**
	* Shutdown mailer pool
	*/
	async shutdown() {
		if (!this.active) return;
		try {
			closeAllMailers();
			this.active = false;
		} catch (error) {
			console.error("Failed to close all mailers:", error);
			throw error;
		}
	}
};
//#endregion
export { MailerConnector };

//# sourceMappingURL=mail-connector.mjs.map