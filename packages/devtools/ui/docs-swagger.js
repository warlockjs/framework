// Starts Swagger UI on the page. The document URL is relative to /docs/swagger,
// so it works under any dashboard base path. The validator badge is off
// (`validatorUrl: null`): this is a loopback dev tool and must not call out.
window.ui = SwaggerUIBundle({
  url: "../api/openapi.json",
  dom_id: "#swagger-ui",
  validatorUrl: null,
  deepLinking: true,
  persistAuthorization: false,
});
