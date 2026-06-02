import { CloudDriver } from "./cloud-driver.mjs";
import { ltrim } from "@mongez/reinforcements";
//#region ../../@warlock.js/core/src/storage/drivers/do-spaces-driver.ts
/**
* DigitalOcean Spaces Storage Driver
*
* Spaces is S3-compatible with a different URL structure.
*
* URL Patterns:
* - With urlPrefix: {urlPrefix}/{key}
* - CDN URL: https://{bucket}.{region}.cdn.digitaloceanspaces.com/{key}
* - Origin URL: https://{bucket}.{region}.digitaloceanspaces.com/{key}
*
* Regions: nyc3, sfo3, ams3, sgp1, fra1, etc.
*
* @example
* ```typescript
* const driver = new DOSpacesDriver({
*   bucket: "my-space",
*   region: "nyc3",
*   accessKeyId: process.env.DO_SPACES_KEY,
*   secretAccessKey: process.env.DO_SPACES_SECRET,
* });
* ```
*/
var DOSpacesDriver = class extends CloudDriver {
	constructor(..._args) {
		super(..._args);
		this.name = "spaces";
	}
	/**
	* Get Spaces endpoint URL
	*
	* Spaces endpoint format: https://{region}.digitaloceanspaces.com
	*/
	getEndpoint() {
		return this.options.endpoint || `https://${this.options.region}.digitaloceanspaces.com`;
	}
	/**
	* Get public URL for file
	*
	* Note: DO Spaces includes automatic CDN with the `.cdn.` subdomain
	*/
	url(location) {
		if (this.options.urlPrefix) location = `${this.options.urlPrefix.replace(/\/+$/, "")}/${ltrim(location, "/")}`;
		return `https://${this.options.bucket}.${this.options.region}.cdn.digitaloceanspaces.com/${location}`;
	}
};
//#endregion
export { DOSpacesDriver };

//# sourceMappingURL=do-spaces-driver.mjs.map