# WR-005: Public typing for native HTTP server options

Packages: `@warlock.js/core` 5.29.0 and Fastify 5.12.5; Node 22.13.0.

Installed Core `HttpConfigurations` omits `serverOptions`, although
`esm/connectors/http-connector.mjs:79` forwards `httpConfig.serverOptions` to
`startHttpServer`. Core `esm/http/server.mjs` spreads those options into Fastify.
Fastify `lib/server.js:337-338` passes `options.http` to Node's `http.createServer`.
The runtime accepts a configuration that the public Core configuration type
cannot express directly.

Request: expose a typed native HTTP options path in `HttpConfigurations` with
the supported Fastify/Node shape. Document that the native header limit belongs
at `http.serverOptions.http.maxHeaderSize`; a top-level `maxHeaderSize` is ignored.

Application workaround: a narrow typed intersection declares only the supported
nested option and sets it to 32768. An isolated source-loaded Warlock/Fastify
server reported `server.maxHeaderSize === 32768`. Real HTTP and Chrome probes
accepted the maximum 4096 CJK-character workspace selector, encoded as 16384
base64url characters, alongside a 2048-byte ancillary header.

Classification: typing/documentation feature request, with no dependency patch.
Raw Unicode rejection by Fetch Headers is a platform/protocol constraint and is
not a Warlock framework defect; Bureau's versioned source header addresses it.

Evidence: the isolated `bureau-2-workspace-source-header` lane's native and Chrome
receipts; its final frozen handoff records exact source and receipt hashes.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
