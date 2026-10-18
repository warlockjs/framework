import ts from "typescript";
import { describe, expect, it } from "vitest";
import { findUnboundedQuantifier, securityFindings } from "./security-conventions";

type Found = { code: string; text: string; message: string };

/** Parse `source` as `fileName` and list what the security checks report. */
function check(source: string, fileName = "src/app/posts/controllers/a.controller.tsx"): Found[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);

  return securityFindings(sourceFile).map((finding) => ({
    code: finding.code,
    text: finding.node.getText(sourceFile),
    message: finding.message,
  }));
}

function codes(source: string, code: string): string[] {
  return check(source)
    .filter((found) => found.code === code)
    .map((found) => found.text);
}

describe("WL9005 request.all() into a query, a service or inApp()", () => {
  it.each([
    "await Post.create(request.validated());",
    "await Post.create({ ...request.validated(), authorId: user.id });",
    "const input = request.all();",
    "return response.success(request.all());",
    "log.debug('posts', 'create', 'input', request.all());",
    "const data = request.all(); return response.success(data);",
    "await createPost(request.only(['title']));",
    "await Post.create(other.all());",
  ])("accepts %s", (source) => {
    expect(codes(source, "WL9005")).toEqual([]);
  });

  it("reports request.all() passed straight to a model call, naming the receiver", () => {
    const [found] = check("await Post.create(request.all());");

    expect(found).toMatchObject({ code: "WL9005", text: "request.all()" });
    expect(found?.message).toContain(
      "`request.all()` passes every client-sent field to `Post.create()`",
    );
    expect(found?.message).toContain("`request.validated()`");
  });

  it.each([
    ["await createUserService({ ...request.all(), role: 'user' });", "request.all()"],
    ["inApp(app, { payload: request.all() });", "request.all()"],
    ["await Post.create(req.heavy() as PostInput);", "req.heavy()"],
    ["await Post.create((request.allExceptParams()));", "request.allExceptParams()"],
  ])("reports %s", (source, text) => {
    expect(codes(source, "WL9005")).toEqual([text]);
  });

  it("follows a local constant into the call that receives it", () => {
    const [found] = check("const data = request.all();\nawait User.query().where(data).first();");

    expect(found?.code).toBe("WL9005");
    expect(found?.message).toContain("to `where()`");
  });
});

describe("WL9006 mutating routes need an auth guard or public: true", () => {
  it.each([
    "router.get('/posts', listPosts);",
    "router.post('/login', loginController, { public: true });",
    "router.post('/posts', createPost, { middleware: [authMiddleware()] });",
    "router.delete('/posts/:id', deletePost, { middleware: [authMiddleware('admin'), audit()] });",
    "router.post('/posts', createPost, sharedOptions);",
    "router.post('/posts', createPost, { middleware: guards });",
    "router.post('/posts', createPost, { middleware: [requireStaffGuard] });",
    "router.post('/posts', createPost, { middleware: [markAuthGuard(requireApiKey)] });",
    "const requireApiKey = markAuthGuard(checkKey);\nrouter.post('/imports', importController, { middleware: [requireApiKey] });",
    "guarded(() => { router.post('/posts', createPost); });",
    "router.group({ middleware: [authMiddleware('user')] }, () => { router.put('/posts/:id', updatePost); });",
    "router.group({ public: true, prefix: '/webhooks' }, () => { router.post('/stripe', stripeWebhook); });",
    "router.prefix('/admin', () => guarded(() => router.patch('/settings', saveSettings)));",
    "router.route('/posts', { middleware: [authMiddleware()] }).create(createPost).update(updatePost);",
    "router.route('/posts').list(listPosts).show(showPost);",
    "router.route('/contact').post(contactController, { public: true });",
    "router.restfulResource('/posts', postsResource, { only: ['list', 'show'] });",
    "router.add('GET', '/health', health);",
    "router.add('POST', '/hook', hook, { public: true });",
    "otherRouter.post('/x', handler);",
  ])("accepts %s", (source) => {
    expect(codes(source, "WL9006")).toEqual([]);
  });

  it("reports an unguarded POST with its method and path", () => {
    const [found] = check("router.post('/posts', createPost);");

    expect(found).toMatchObject({ code: "WL9006", text: "router.post('/posts', createPost)" });
    expect(found?.message).toContain("Mutating route `POST /posts` has no auth middleware");
    expect(found?.message).toContain("`public: true`");
  });

  it.each([
    ["router.delete('/posts/:id', deletePost, { name: 'posts.delete' });", "DELETE /posts/:id"],
    ["router.put('/posts/:id', updatePost, { middleware: [rateLimit()] });", "PUT /posts/:id"],
    ["router.prefix('/posts', () => { router.patch('/:id', patchPost); });", "PATCH /:id"],
    [
      "router.group({ middleware: [cors()] }, () => { router.post('/posts', createPost); });",
      "POST /posts",
    ],
    ["router.route('/posts').list(listPosts).create(createPost);", "create /posts"],
    ["router.restfulResource('/posts', postsResource);", "resource /posts"],
    ["router.add('DELETE', '/cache', clearCache);", "DELETE /cache"],
    ["router.post('/posts', createPost, { public: false });", "POST /posts"],
    ["adminOnly(() => { router.post('/users', createUser); });", "POST /users"],
    [
      "const optionalUser = markAuthGuard(readUser, false);\nrouter.post('/users', createUser, { middleware: [optionalUser] });",
      "POST /users",
    ],
    ["router.post(`/users`, createUser, { middleware: [requireStaff()] });", "POST /users"],
  ])("reports %s", (source, route) => {
    const found = check(source).filter((item) => item.code === "WL9006");

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain(`\`${route}\``);
  });
});

describe("WL9007 redirect targets from request input", () => {
  it.each([
    "response.redirect('/dashboard');",
    "response.redirect(safeRedirect(request.input('next')));",
    "response.redirect(safeRedirect(request.input('next'), { allowedOrigins: ['https://app.example.com'] }));",
    "const next = safeRedirect(request.input('next')); response.redirect(next);",
    "if (isSafeRedirect(request.input('next'))) response.redirect(request.input('next'));",
    "const back = isSafeRedirect(request.input('next')) ? response.redirect(request.input('next')) : null;",
    "router.redirect('/old', '/new');",
    "response.redirect(`/posts/${post.id}`);",
    "const element = <Link to={`/posts/${post.id}`}>Post</Link>;",
    "const element = <Link to={safeRedirectTarget(useQueryString('next')) ?? '/'}>Back</Link>;",
    "const element = <a href={useQueryString('next')}>Back</a>;",
  ])("accepts %s", (source) => {
    expect(codes(source, "WL9007")).toEqual([]);
  });

  it("reports a server redirect and names safeRedirect() from core", () => {
    const [found] = check("response.redirect(request.input('next'));");

    expect(found).toMatchObject({ code: "WL9007", text: "request.input('next')" });
    expect(found?.message).toContain("This redirect target comes from request input");
    expect(found?.message).toContain("`safeRedirect()` from `@warlock.js/core`");
  });

  it.each([
    ["response.redirect(request.query.returnTo, 302);", "request.query.returnTo"],
    ["const next = request.string('next');\nreturn response.redirect('/' + next);", "'/' + next"],
    ["const element = <Link href={query.returnTo}>Back</Link>;", "query.returnTo"],
    ["const element = <Link to={location.search}>Back</Link>;", "location.search"],
    ["const element = <NavLink to={window.location.hash} />;", "window.location.hash"],
  ])("reports %s", (source, text) => {
    expect(codes(source, "WL9007")).toEqual([text]);
  });

  it("names safeRedirectTarget() from web for navigateTo() and links", () => {
    const [navigation] = check("navigateTo(useQueryString('next'));");
    const [link] = check("const element = <Link to={useQueryString('next')}>Back</Link>;");

    expect(navigation?.message).toContain("This navigation target");
    expect(navigation?.message).toContain("`safeRedirectTarget()` from `@warlock.js/web`");
    expect(link?.message).toContain("This link target");
    expect(link?.text).toBe("useQueryString('next')");
  });
});

describe("WL9008 sensitive values in logs", () => {
  it.each([
    "log.info('auth', 'login', 'Signed in', { userId: user.id });",
    "log.info('auth', 'login', `Signed in ${maskEmail(user.email)}`);",
    "log.info('auth', 'reset', 'Reset requested', { email: maskEmail(request.input('email')) });",
    "log.info('auth', 'login', 'Issued', { token: accessToken, refreshToken });",
    "log.info('http', 'request', request.url, { request: request.toLogSnapshot() });",
    "log.warn('posts', 'create', 'Title too long', { title: request.body.title });",
    "log.error('mail', 'send', 'Failed', redact({ to: user.email }));",
    "log.info('auth', 'login', 'Escaped', { agent: escapeLogValue(request.input('agent')) });",
    "log.info('billing', 'charge', 'Charged', { cardNumber });",
    "console.log(post.title);",
    "mailer.send(user.email);",
    "log.info('users', 'verified', 'ok', { emailVerifiedCount: count });",
  ])("accepts %s", (source) => {
    expect(codes(source, "WL9008")).toEqual([]);
  });

  it.each([
    ["log.info('auth', 'login', `Signed in ${user.email}`);", "user.email", "a raw email address"],
    [
      "log.info('auth', 'login', 'Signed in', { user: user.email });",
      "user.email",
      "a raw email address",
    ],
    ["log.info('auth', 'login', 'Signed in', { email });", "email", "a raw email address"],
    [
      "log.debug('auth', 'token', 'Issued ' + accessToken);",
      "accessToken",
      "the credential `accessToken`",
    ],
    [
      "logger.debug('auth', 'token', 'Issued', { value: session.refreshToken });",
      "session.refreshToken",
      "the credential `refreshToken`",
    ],
    [
      "log.info('posts', 'create', 'Input', request.all());",
      "request.all()",
      "the request body (`all`)",
    ],
    ["console.log(JSON.stringify(request.body));", "request.body", "the request body (`body`)"],
    [
      "log.warn('http', 'headers', 'Headers', { headers: request.headers });",
      "request.headers",
      "the request headers",
    ],
    [
      "log.info('auth', 'reset', 'Reset for ' + request.input('email'));",
      "request.input('email')",
      "a raw email address",
    ],
    [
      "request.log(`password=${request.input('password')}`);",
      "request.input('password')",
      "the credential `password`",
    ],
    ["log.info('users', 'seen', user.email.trim());", "user.email", "a raw email address"],
    [
      "log.info('billing', 'charge', 'Card ' + cardNumber);",
      "cardNumber",
      "the credential `cardNumber`",
    ],
  ])("reports %s", (source, text, what) => {
    const found = check(source).filter((item) => item.code === "WL9008");

    expect(found.map((item) => item.text)).toEqual([text]);
    expect(found[0]?.message).toContain(`Do not log ${what} as-is`);
  });
});

describe("WL9009 unbounded regex quantifiers on request input", () => {
  it.each([
    ["^\\d+$", "+"],
    ["a.*b", "*"],
    ["a.*?b", "*?"],
    ["x{2,}", "{2,}"],
  ])("finds the quantifier in %s", (source, quantifier) => {
    expect(findUnboundedQuantifier(source)).toBe(quantifier);
  });

  it.each(["^\\d{1,10}$", "[+*]", "\\+\\*", "a{2}", "a{2,5}", "abc"])("accepts %s", (source) => {
    expect(findUnboundedQuantifier(source)).toBeUndefined();
  });

  it.each([
    "/^\\d{1,10}$/.test(request.input('code'));",
    "/^\\d+$/.test(config.port);",
    "const slug = request.string('slug'); slug.replace(/-{1,8}/g, '-');",
    "/^[a-z]+$/.test(safe.slice(0, 64));",
    "const pattern = /^[a-z0-9-]{1,64}$/; pattern.test(request.input('slug'));",
  ])("accepts %s", (source) => {
    expect(codes(source, "WL9009")).toEqual([]);
  });

  it.each([
    ["/^(a+)+$/.test(request.input('name'));", "+"],
    [
      "const EMAIL = /^\\S+@\\S+$/;\nif (!EMAIL.test(request.input('email'))) throw new Error();",
      "+",
    ],
    ["request.string('query').match(/(\\w*)*/);", "*"],
    ["const term = request.input('q');\nterm.replace(new RegExp('\\\\s{2,}', 'g'), ' ');", "{2,}"],
    ["new RegExp('^.*$').exec(req.body.text);", "*"],
  ])("reports %s", (source, quantifier) => {
    const found = check(source).filter((item) => item.code === "WL9009");

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain(`unbounded quantifier (\`${quantifier}\`)`);
  });

  it("does not trust a let that is assigned again", () => {
    expect(
      codes(
        "let pattern = /^[a-z]{1,8}$/;\npattern = /^.*$/;\npattern.test(request.input('q'));",
        "WL9009",
      ),
    ).toEqual([]);
  });
});
