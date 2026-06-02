import { CloudDriver } from "./cloud-driver.mjs";
import { ltrim } from "@mongez/reinforcements";
//#region ../../@warlock.js/core/src/storage/drivers/s3-driver.ts
/**
* AWS S3 Storage Driver
*
* URL Pattern: https://{bucket}.s3.{region}.amazonaws.com/{key}
*
* @example
* ```typescript
* const driver = new S3Driver({
*   bucket: "my-bucket",
*   region: "us-east-1",
*   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
*   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
* });
* ```
*/
var S3Driver = class extends CloudDriver {
	constructor(..._args) {
		super(..._args);
		this.name = "s3";
	}
	/**
	* Get public URL for file
	*
	* URL formats:
	* - With urlPrefix: {urlPrefix}/{key}
	* - Default: https://{bucket}.s3.{region}.amazonaws.com/{key}
	*/
	url(location) {
		if (this.options.urlPrefix) location = `${this.options.urlPrefix.replace(/\/+$/, "")}/${ltrim(location, "/")}`;
		return `https://${this.options.bucket}.s3.${this.options.region}.amazonaws.com/${location}`;
	}
};
//#endregion
export { S3Driver };

//# sourceMappingURL=s3-driver.mjs.map