import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";
import { UploadedFile } from "../../http";
import { isMarkupMimeType, isRasterImageMimeType } from "../../http/uploads/sniff-upload-type";

/**
 * Extensions that name a markup type, for {@link fileExtensionRule}'s check
 * that markup bytes are only accepted when the app listed a markup extension.
 */
const MARKUP_EXTENSIONS = new Set(["svg", "svgz", "html", "htm", "xhtml", "xml", "js", "mjs"]);

/**
 * File rule - validates uploaded file
 */
export const fileRule: SchemaRule = {
  name: "file",
  defaultErrorMessage: "The :input must be a file",
  async validate(value: any, context) {
    if (value instanceof UploadedFile) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Image rule - validates uploaded image by its bytes, not by the type or name
 * the client declared. Raster images pass (jpeg, png, webp, gif, avif,
 * heic/heif, bmp, tiff, ico); svg passes only with `{ svg: true }`, since an
 * svg can carry script.
 */
export const imageRule: SchemaRule<{ svg?: boolean }> = {
  name: "image",
  defaultErrorMessage: "The :input must be an image",
  async validate(value: any, context) {
    if (!(value instanceof UploadedFile)) {
      return invalidRule(this, context);
    }

    const detected = await value.detectedMimeType();

    if (isRasterImageMimeType(detected)) {
      return VALID_RULE;
    }

    if (detected === "image/svg+xml" && this.context.options?.svg === true) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

/**
 * Whether an upload's bytes are markup (svg, html, xml) the caller did not
 * allow: a file declared as one type must not smuggle a page or script in.
 */
async function isUnexpectedMarkup(value: any, allowed: (detected: string) => boolean) {
  if (!(value instanceof UploadedFile)) return false;

  const detected = await value.detectedMimeType();

  return isMarkupMimeType(detected) && !allowed(detected as string);
}

/**
 * File extension rule - validates file extension.
 *
 * The extension comes from the client's file name; a file whose bytes are
 * markup (svg, html, xml) is refused unless a markup extension is listed.
 */
export const fileExtensionRule: SchemaRule<{
  extensions: string | string[];
}> = {
  name: "fileExtension",
  errorMessage: "The :input must have one of the following extensions: :extensions",
  async validate(value: any, context) {
    let extensions = this.context.options.extensions;

    if (typeof extensions === "string") {
      extensions = [extensions];
    }

    if (!extensions.includes(value.extension)) {
      return invalidRule(this, context);
    }

    const listsMarkup = extensions.some((extension) =>
      MARKUP_EXTENSIONS.has(String(extension).toLowerCase()),
    );

    if (await isUnexpectedMarkup(value, () => listsMarkup)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

/**
 * File type rule - validates MIME type.
 *
 * The declared type must be listed; a file whose bytes are markup (svg, html,
 * xml) is refused unless that markup type is listed too.
 */
export const fileTypeRule: SchemaRule<{ mimeTypes: string | string[] }> = {
  name: "fileType",
  defaultErrorMessage: "The :input must be a :types file",
  async validate(value: any, context) {
    const configured = this.context.options.mimeTypes;
    const mimeTypes = typeof configured === "string" ? [configured] : configured;

    if (!mimeTypes.includes(value.mimeType)) {
      return invalidRule(this, context);
    }

    if (await isUnexpectedMarkup(value, (detected) => mimeTypes.includes(detected))) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};
