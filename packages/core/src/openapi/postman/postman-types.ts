/**
 * The slice of the Postman Collection Format v2.1.0 the converter emits.
 * Schema: https://schema.getpostman.com/json/collection/v2.1.0/collection.json
 */

export type PostmanVariable = {
  key: string;
  value: string;
  type?: "string";
  description?: string;
};

export type PostmanAuthEntry = { key: string; value: string; type: "string" };

export type PostmanAuth = { type: "noauth" } | { type: "bearer"; bearer: PostmanAuthEntry[] };

export type PostmanHeader = {
  key: string;
  value: string;
  type?: "text";
  description?: string;
  disabled?: boolean;
};

export type PostmanQueryParam = {
  key: string;
  value: string;
  description?: string;
  disabled?: boolean;
};

export type PostmanUrl = {
  raw: string;
  host: string[];
  path: string[];
  variable?: PostmanVariable[];
  query?: PostmanQueryParam[];
};

export type PostmanFormParam =
  | { key: string; value: string; type: "text"; description?: string }
  | { key: string; type: "file"; src: string[]; description?: string };

export type PostmanBody =
  | { mode: "raw"; raw: string; options: { raw: { language: "json" | "text" } } }
  | { mode: "formdata"; formdata: PostmanFormParam[] }
  | { mode: "urlencoded"; urlencoded: { key: string; value: string; type: "text" }[] };

export type PostmanOriginalRequest = {
  method: string;
  header: PostmanHeader[];
  body?: PostmanBody;
  url: PostmanUrl;
};

export type PostmanRequest = PostmanOriginalRequest & {
  auth?: PostmanAuth;
  description?: string;
};

export type PostmanResponse = {
  name: string;
  originalRequest: PostmanOriginalRequest;
  status: string;
  code: number;
  _postman_previewlanguage: "json" | "html" | "text";
  header: PostmanHeader[];
  body: string;
};

export type PostmanRequestItem = {
  name: string;
  request: PostmanRequest;
  response: PostmanResponse[];
};

export type PostmanFolder = {
  name: string;
  item: PostmanItem[];
};

export type PostmanItem = PostmanFolder | PostmanRequestItem;

export type PostmanCollection = {
  info: {
    _postman_id: string;
    name: string;
    description?: string;
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";
  };
  item: PostmanItem[];
  auth?: PostmanAuth;
  variable: PostmanVariable[];
};

export type PostmanCollectionOptions = {
  /** Collection name. Defaults to `info.title` of the document. */
  title?: string;
  /** Value of the `{{baseUrl}}` variable. Defaults to `servers[0].url`, else `http://localhost:3000`. */
  baseUrl?: string;
};
