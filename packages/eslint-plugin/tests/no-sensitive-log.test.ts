import { noSensitiveLog } from "../src/rules/no-sensitive-log";
import { createRuleTester } from "./rule-tester";

createRuleTester().run("no-sensitive-log", noSensitiveLog, {
  valid: [
    "log.info('auth', 'login', 'Signed in', { userId: user.id });",
    "log.info('auth', 'login', `Signed in ${maskEmail(user.email)}`);",
    "log.info('auth', 'reset', 'Reset requested', { email: maskEmail(request.input('email')) });",
    "log.info('auth', 'login', 'Issued', { token: accessToken, refreshToken });",
    "log.info('http', 'request', request.url, { request: request.toLogSnapshot() });",
    "log.warn('posts', 'create', 'Title too long', { title: request.body.title });",
    "log.error('mail', 'send', 'Failed', redact({ to: user.email }));",
    "log.info('auth', 'login', 'Escaped', { agent: escapeLogValue(request.input('agent')) });",
    "console.log(post.title);",
    "mailer.send(user.email);",
    "log.info('users', 'verified', 'ok', { emailVerifiedCount: count });",
  ],
  invalid: [
    {
      code: "log.info('auth', 'login', `Signed in ${user.email}`);",
      errors: [{ messageId: "sensitive", data: { what: "a raw email address" } }],
    },
    {
      code: "log.info('auth', 'login', 'Signed in', { user: user.email });",
      errors: [{ messageId: "sensitive", data: { what: "a raw email address" } }],
    },
    {
      code: "log.info('auth', 'login', 'Signed in', { email });",
      errors: [{ messageId: "sensitive" }],
    },
    {
      code: "log.debug('auth', 'token', 'Issued ' + accessToken);",
      errors: [{ messageId: "sensitive", data: { what: "the credential `accessToken`" } }],
    },
    {
      code: "logger.debug('auth', 'token', 'Issued', { value: session.refreshToken });",
      errors: [{ messageId: "sensitive" }],
    },
    {
      code: "log.info('posts', 'create', 'Input', request.all());",
      errors: [{ messageId: "sensitive", data: { what: "the request body (`all`)" } }],
    },
    {
      code: "console.log(JSON.stringify(request.body));",
      errors: [{ messageId: "sensitive", data: { what: "the request body (`body`)" } }],
    },
    {
      code: "log.warn('http', 'headers', 'Headers', { headers: request.headers });",
      errors: [{ messageId: "sensitive", data: { what: "the request headers" } }],
    },
    {
      code: "log.info('auth', 'reset', 'Reset for ' + request.input('email'));",
      errors: [{ messageId: "sensitive", data: { what: "a raw email address" } }],
    },
    {
      code: "request.log(`password=${request.input('password')}`);",
      errors: [{ messageId: "sensitive" }],
    },
  ],
});
