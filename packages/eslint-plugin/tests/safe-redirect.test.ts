import { safeRedirect } from "../src/rules/safe-redirect";
import { createRuleTester } from "./rule-tester";

createRuleTester().run("safe-redirect", safeRedirect, {
  valid: [
    "response.redirect('/dashboard');",
    "response.redirect(safeRedirect(request.input('next')));",
    "response.redirect(safeRedirect(request.input('next'), { allowedOrigins: ['https://app.example.com'] }));",
    "const next = safeRedirect(request.input('next')); response.redirect(next);",
    "if (isSafeRedirect(request.input('next'))) response.redirect(request.input('next'));",
    "router.redirect('/old', '/new');",
    "response.redirect(`/posts/${post.id}`);",
    "const element = <Link to={`/posts/${post.id}`}>Post</Link>;",
    "const element = <Link to={safeRedirectTarget(useQueryString('next')) ?? '/'}>Back</Link>;",
    "const element = <a href={useQueryString('next')}>Back</a>;",
  ],
  invalid: [
    {
      code: "import { router } from \"@warlock.js/core\";\nresponse.redirect(request.input('next'));",
      errors: [
        {
          messageId: "redirect",
          data: { what: "redirect", helper: "safeRedirect" },
          suggestions: [
            {
              messageId: "wrap",
              output:
                "import { router, safeRedirect } from \"@warlock.js/core\";\nresponse.redirect(safeRedirect(request.input('next')));",
            },
          ],
        },
      ],
    },
    {
      code: "response.redirect(request.query.returnTo, 302);",
      errors: [
        {
          messageId: "redirect",
          suggestions: [
            {
              messageId: "wrap",
              output:
                'import { safeRedirect } from "@warlock.js/core";\nresponse.redirect(safeRedirect(request.query.returnTo), 302);',
            },
          ],
        },
      ],
    },
    {
      code: "const next = request.string('next');\nreturn response.redirect('/' + next);",
      errors: [{ messageId: "redirect", suggestions: 1 }],
    },
    {
      code: "navigateTo(useQueryString('next'));",
      errors: [
        {
          messageId: "redirect",
          data: { what: "navigation", helper: "safeRedirectTarget" },
          suggestions: 1,
        },
      ],
    },
    {
      code: "import { Link } from \"@warlock.js/web\";\nconst element = <Link to={useQueryString('next')}>Back</Link>;",
      errors: [
        {
          messageId: "redirect",
          data: { what: "link", helper: "safeRedirectTarget" },
          suggestions: [
            {
              messageId: "wrap",
              output:
                'import { Link, safeRedirectTarget } from "@warlock.js/web";\nconst element = <Link to={safeRedirectTarget(useQueryString(\'next\')) ?? "/"}>Back</Link>;',
            },
          ],
        },
      ],
    },
    {
      code: "const element = <Link href={query.returnTo}>Back</Link>;",
      errors: [{ messageId: "redirect", suggestions: 1 }],
    },
    {
      code: "const element = <Link to={location.search}>Back</Link>;",
      errors: [{ messageId: "redirect", suggestions: 1 }],
    },
  ],
});
