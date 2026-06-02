import { log } from "@warlock.js/logger";
//#region ../../@warlock.js/core/src/mail/mailer-pool.ts
/**
* Installation instructions for nodemailer
*/
const NODEMAILER_INSTALL_INSTRUCTIONS = `
Email functionality requires the nodemailer package.
Install it with:

  warlock add mail

Or manually:

  npm install nodemailer
  pnpm add nodemailer
  yarn add nodemailer
`.trim();
/**
* Module availability flag
*/
let moduleExists = null;
/**
* Cached nodemailer module (loaded at import time)
*/
let nodemailerModule;
let nodemailerLoadPromise = null;
/**
* Eagerly load nodemailer module at import time
*/
async function loadNodemailerModule() {
	try {
		nodemailerModule = (await import("nodemailer")).default;
		moduleExists = true;
	} catch {
		moduleExists = false;
	}
}
nodemailerLoadPromise = loadNodemailerModule();
const SES_INSTALL_INSTRUCTIONS = `
AWS SES functionality requires the @aws-sdk/client-sesv2 package.
Install it with:

  warlock add ses

Or manually:

  npm install @aws-sdk/client-sesv2
  pnpm add @aws-sdk/client-sesv2
  yarn add @aws-sdk/client-sesv2
`.trim();
let sesModuleExists = null;
let sesModule;
let sesLoadPromise = null;
async function loadSesModule() {
	try {
		sesModule = (await import("@aws-sdk/client-sesv2")).default;
		sesModuleExists = true;
	} catch {
		sesModuleExists = false;
	}
}
sesLoadPromise = loadSesModule();
function isSesConfig(config) {
	return "driver" in config && config.driver === "ses";
}
async function getSesMailer(config) {
	if (sesModuleExists === null && sesLoadPromise) await sesLoadPromise;
	if (sesModuleExists === false) throw new Error(`@aws-sdk/client-sesv2 is not installed.\n\n${SES_INSTALL_INSTRUCTIONS}`);
	const hash = `ses_${config.region}_${config.accessKeyId}`;
	const existingTransporter = mailerPool.get(hash);
	if (existingTransporter) return existingTransporter;
	log.info("mail", "pool", `Creating new SES mailer transport (pool size: ${mailerPool.size + 1})`);
	const ses = new sesModule.SESv2Client({
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey
		}
	});
	const transporter = nodemailerModule.createTransport({ SES: {
		sesClient: ses,
		SendEmailCommand: sesModule.SendEmailCommand
	} });
	mailerPool.set(hash, transporter);
	return transporter;
}
/**
* Mailer pool for connection reuse
* Maps config hash to transporter instance
*/
const mailerPool = /* @__PURE__ */ new Map();
/**
* Create a hash from mail configuration for pooling
*/
function createConfigHash(config) {
	const key = JSON.stringify({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: config.auth,
		username: config.username,
		password: config.password
	});
	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		const char = key.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return `mailer_${hash}`;
}
/**
* Get hash for any mailer config
*/
function getMailerHash(config) {
	if (isSesConfig(config)) return `ses_${config.region}_${config.accessKeyId}`;
	return createConfigHash(config);
}
/**
* Get or create a mailer transporter from the pool
* Nodemailer is eagerly loaded at import time
*/
async function getMailer(config) {
	if (moduleExists === null && nodemailerLoadPromise) await nodemailerLoadPromise;
	if (moduleExists === false) throw new Error(`nodemailer is not installed.\n\n${NODEMAILER_INSTALL_INSTRUCTIONS}`);
	if (isSesConfig(config)) return getSesMailer(config);
	const hash = getMailerHash(config);
	const existingTransporter = mailerPool.get(hash);
	if (existingTransporter) return existingTransporter;
	log.info("mail", "pool", `Creating new mailer transport (pool size: ${mailerPool.size + 1})`);
	const { auth, username, password, requireTLS, tls, ...transportConfig } = config;
	const transporter = nodemailerModule.createTransport({
		requireTLS: requireTLS ?? tls,
		auth: auth ?? {
			user: username,
			pass: password
		},
		...transportConfig
	});
	mailerPool.set(hash, transporter);
	return transporter;
}
/**
* Verify a mailer connection
*/
async function verifyMailer(config) {
	const transporter = await getMailer(config);
	try {
		await transporter.verify();
		return true;
	} catch {
		return false;
	}
}
/**
* Close a specific mailer connection
*/
function closeMailer(config) {
	const hash = getMailerHash(config);
	const transporter = mailerPool.get(hash);
	if (transporter) {
		transporter.close();
		mailerPool.delete(hash);
		log.info("mail", "pool", `Closed mailer transport (pool size: ${mailerPool.size})`);
	}
}
/**
* Close all mailer connections
*/
function closeAllMailers() {
	for (const [hash, transporter] of mailerPool) {
		transporter.close();
		mailerPool.delete(hash);
	}
	log.info("mail", "pool", "Closed all mailer transports");
}
/**
* Get pool statistics
*/
function getPoolStats() {
	return {
		size: mailerPool.size,
		hashes: Array.from(mailerPool.keys())
	};
}
//#endregion
export { closeAllMailers, closeMailer, getMailer, getPoolStats, verifyMailer };

//# sourceMappingURL=mailer-pool.mjs.map