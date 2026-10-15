import type { FastifyInstance } from "fastify";
import type { MountDevtoolsRoutesDeps } from "./types";

const MAIL_HTML_CSP =
  "sandbox; default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'";

/** Registers the mailbox list, single-mail detail, and mail HTML routes. */
export function registerMailRoutes(server: FastifyInstance, deps: MountDevtoolsRoutesDeps): void {
  server.get("/api/mails", async () => deps.collector.listMails());

  server.get<{ Params: { id: string } }>("/api/mails/:id", async (request, reply) => {
    const mail = deps.collector.getMail(request.params.id);

    if (!mail) {
      reply.code(404).send();
      return;
    }

    const { html, ...rest } = mail;
    return rest;
  });

  server.get<{ Params: { id: string } }>("/api/mails/:id/html", async (request, reply) => {
    const mail = deps.collector.getMail(request.params.id);

    if (!mail || !mail.html) {
      reply.code(404).send();
      return;
    }

    reply
      .header("Content-Security-Policy", MAIL_HTML_CSP)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Type", "text/html; charset=utf-8")
      .send(mail.html);
  });
}
