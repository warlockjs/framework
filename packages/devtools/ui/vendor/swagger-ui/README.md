# Swagger UI (vendored)

`swagger-ui-bundle.js` and `swagger-ui.css` are the unmodified prebuilt browser
files of [`swagger-ui-dist`](https://github.com/swagger-api/swagger-ui) **5.33.0**
(the same names in the npm package), vendored so apps that add
`@warlock.js/devtools` install nothing extra. They are served only by the
devtools API docs page (`/__warlock/docs/swagger`), in development, to loopback
clients, as `assets/swagger-ui-bundle.js` and `assets/swagger-ui.css`.

The page (`ui/docs-swagger.html` + `ui/docs-swagger.js`) turns the schema
validator badge off (`validatorUrl: null`), so nothing is fetched from an outside
host unless you press "Try it out" against a server listed in the document.

Files here:

- `swagger-ui-bundle.js`, `swagger-ui.css` — the vendored build.
- `LICENSE`, `NOTICE` — Apache-2.0 license and notice, copied verbatim from the package.
- `swagger-ui-bundle.js.LICENSE.txt` — third-party licenses of the bundled libraries, copied verbatim from the package.

To update: `npm pack swagger-ui-dist@<version>`, extract it, copy
`package/swagger-ui-bundle.js`, `package/swagger-ui.css`, `package/LICENSE`,
`package/NOTICE` and `package/swagger-ui-bundle.js.LICENSE.txt` over the files
here unchanged, update the version above, and re-check the page in a browser
for outside requests.

## License

Swagger UI is licensed under the Apache License 2.0 — see `LICENSE` and `NOTICE`.
