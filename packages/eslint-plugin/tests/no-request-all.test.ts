import { noRequestAll } from "../src/rules/no-request-all";
import { createRuleTester } from "./rule-tester";

createRuleTester().run("no-request-all", noRequestAll, {
  valid: [
    "await Post.create(request.validated());",
    "await Post.create({ ...request.validated(), authorId: user.id });",
    "const input = request.all();",
    "return response.success(request.all());",
    "log.debug('posts', 'create', 'input', request.all());",
    "const data = request.all(); return response.success(data);",
    "await createPost(request.only(['title']));",
    "await Post.create(other.all());",
  ],
  invalid: [
    {
      code: "await Post.create(request.all());",
      errors: [
        {
          messageId: "passed",
          data: { request: "request", method: "all", callee: "Post.create()" },
          suggestions: [
            { messageId: "useValidated", output: "await Post.create(request.validated());" },
          ],
        },
      ],
    },
    {
      code: "await createUserService({ ...request.all(), role: 'user' });",
      errors: [
        {
          messageId: "passed",
          suggestions: [
            {
              messageId: "useValidated",
              output: "await createUserService({ ...request.validated(), role: 'user' });",
            },
          ],
        },
      ],
    },
    {
      code: "inApp(app, { payload: request.all() });",
      errors: [{ messageId: "passed", suggestions: 1 }],
    },
    {
      code: "const data = request.all();\nawait User.query().where(data).first();",
      errors: [
        {
          messageId: "passed",
          data: { request: "request", method: "all", callee: "where()" },
          suggestions: 1,
        },
      ],
    },
    {
      code: "await Post.create(req.heavy() as PostInput);",
      errors: [{ messageId: "passed", suggestions: 1 }],
    },
    {
      code: "await Post.create(ctx.allExceptParams());",
      options: [{ requestNames: ["ctx"] }],
      errors: [{ messageId: "passed", suggestions: 1 }],
    },
  ],
});
