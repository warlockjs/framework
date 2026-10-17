import { requireRouteGuard } from "../src/rules/require-route-guard";
import { createRuleTester } from "./rule-tester";

createRuleTester().run("require-route-guard", requireRouteGuard, {
  valid: [
    "router.get('/posts', listPosts);",
    "router.post('/login', loginController, { public: true });",
    "router.post('/posts', createPost, { middleware: [authMiddleware()] });",
    "router.delete('/posts/:id', deletePost, { middleware: [authMiddleware('admin'), audit()] });",
    "router.post('/posts', createPost, sharedOptions);",
    "router.post('/posts', createPost, { middleware: guards });",
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
    {
      code: "adminOnly(() => { router.post('/users', createUser); });",
      options: [{ guardFunctions: ["adminOnly"] }],
    },
    {
      code: "router.post('/users', createUser, { middleware: [requireStaff()] });",
      options: [{ guardMiddleware: ["requireStaff"] }],
    },
    "otherRouter.post('/x', handler);",
  ],
  invalid: [
    {
      code: "router.post('/posts', createPost);",
      errors: [
        {
          messageId: "unguarded",
          data: { method: "POST /posts" },
          suggestions: [
            {
              messageId: "markPublic",
              output: "router.post('/posts', createPost, { public: true });",
            },
          ],
        },
      ],
    },
    {
      code: "router.delete('/posts/:id', deletePost, { name: 'posts.delete' });",
      errors: [
        {
          messageId: "unguarded",
          suggestions: [
            {
              messageId: "markPublic",
              output:
                "router.delete('/posts/:id', deletePost, { public: true, name: 'posts.delete' });",
            },
          ],
        },
      ],
    },
    {
      code: "router.put('/posts/:id', updatePost, { middleware: [rateLimit()] });",
      errors: [{ messageId: "unguarded", suggestions: 1 }],
    },
    {
      code: "router.prefix('/posts', () => { router.patch('/:id', patchPost); });",
      errors: [{ messageId: "unguarded", data: { method: "PATCH /:id" }, suggestions: 1 }],
    },
    {
      code: "router.group({ middleware: [cors()] }, () => { router.post('/posts', createPost); });",
      errors: [{ messageId: "unguarded", suggestions: 1 }],
    },
    {
      code: "router.route('/posts').list(listPosts).create(createPost);",
      errors: [
        {
          messageId: "unguarded",
          data: { method: "create /posts" },
          suggestions: [
            {
              messageId: "markPublic",
              output:
                "router.route('/posts').list(listPosts).create(createPost, { public: true });",
            },
          ],
        },
      ],
    },
    {
      code: "router.restfulResource('/posts', postsResource);",
      errors: [{ messageId: "unguarded", data: { method: "resource /posts" }, suggestions: 1 }],
    },
    {
      code: "router.add('DELETE', '/cache', clearCache);",
      errors: [{ messageId: "unguarded", data: { method: "DELETE /cache" }, suggestions: 1 }],
    },
    {
      code: "router.post('/posts', createPost, { public: false });",
      errors: [{ messageId: "unguarded", suggestions: 1 }],
    },
  ],
});
