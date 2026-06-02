# Warlock.js — marketing & adoption playbook

> The honest, no-fluff plan for taking Warlock from "Hasan's framework"
> to "a framework other people use." Written to be followed even when
> it's the hard, slow way — because it is the hard, slow way. There is
> no shortcut here, only consistency.

## The core truth

**The technology is not the bottleneck. Distribution is.**

Warlock's internals are genuinely good — better than NestJS, comparable
to or cleaner than AdonisJS. That is necessary but not sufficient.
NestJS has mediocre code and 100k+ stars. AdonisJS has clean code and a
fraction of that. The variable that decides which framework wins is
almost never code quality. It's mindshare, longevity signals, and a
human voice attached to the project.

Internalise this: **the next few years are 80% writing / teaching /
positioning and 20% code.** The code work is done enough to be
credible. The rest is the job now.

## 1. Positioning — pick one sharp story

A feature list is not a story. "TypeScript backend framework with HMR,
ORM, auth, scheduling, AI, ..." is a feature list. Nobody adopts feature
lists.

**The story to own: the AI-first backend framework.** Nobody owns this
niche yet:

- NestJS has AI tutorials but no AI primitives.
- AdonisJS doesn't touch AI.
- Encore is platform-focused.
- Express/Fastify are unopinionated plumbing.

Warlock designed AI in from the start (the `@warlock.js/ai*` packages,
provider abstraction, workflow primitives). That's a real, defensible
differentiator and the market is growing fast.

Rule: **a framework that is #1 in a small niche beats a framework that
is #5 in a big niche.** Commit to "AI-first backend, with strict app
structure your team can scale on." Every blog post, demo, and example
leads with an AI capability — "and the rest of the framework is solid
too" is the footnote, not the headline.

Action items:
- [ ] Rewrite the landing page around the AI-first story.
- [ ] Every example app does something with AI.
- [ ] The README's first paragraph is the positioning sentence, not a
      feature table.

## 2. Build in public, relentlessly

The single most reliable adoption tactic for a solo-maintainer
framework: **a build-log every week for at least 12 months.**

Not "v4.1 released!" changelog posts. Narrative posts about *decisions*:

- "Why I built my own HMR loader hook instead of using
  webpack-dev-server" ← write this one first; the
  `domains/core/how-it-works/how-does-dev-server-work.md` doc is the
  raw material, it nearly writes itself.
- "Why Warlock middleware has no `next()`"
- "Designing an ORM that handles circular relations without footguns"
- "How AsyncLocalStorage gives Warlock request-scoped context with zero
  parameter threading"

This is how Solid (Ryan Carniato's reactivity threads), Astro (Fred K
Schott's MPA-vs-SPA posts), HTMX, and Bun all built audiences. The
frameworks with no human voice attached die quietly. Pick **one**
primary platform and post consistently:

- Personal blog (own the canonical copy — syndicate everywhere else)
- dev.to (good reach for backend/TS content)
- Hacker News (at most a few times a year, only when substantial)
- Reddit r/typescript, r/node (read each sub's self-promo rules first)
- LinkedIn (lower technical signal, but MENA/regional reach)
- X / Bluesky (threads about decisions, not announcements)

Action items:
- [ ] Pick the primary platform. Commit to weekly for 12 months.
- [ ] First post: the HMR loader-hook design writeup.
- [ ] Maintain a backlog of 10 "decision" post ideas so you never stall.

## 3. Ship case studies — yours count first

You have production apps on Warlock (this online-store backend, for
one). The most credible signal a framework author can send is *"I trust
this for my own production code."* Most authors don't, and evaluators
notice.

- Write "How we built the online-store backend in Warlock —
  architecture, lessons, what we'd change." Honest, including the warts.
- One *external* company on Warlock with a public writeup is worth more
  than fifty of your own posts. Offer free architecture help to devs you
  know personally in exchange for early adoption + a writeup.

Action items:
- [ ] One self-authored production case study.
- [ ] Identify 3 devs/companies in your network who could be early
      adopters; offer hands-on help.

## 4. Onboarding must be ruthless

The fastest way to lose a potential user is `npm create warlock`
failing on Windows, or the first `warlock dev` printing a confusing
error.

- The Quickstart page is sacred: a complete stranger goes from
  `npm create warlock` to a working endpoint in **under 5 minutes**,
  zero forks, zero "if you want X see Y." Time it on a clean VM monthly.
- Watch real developers do it on a screen-share. One session teaches
  more than 100 GitHub issues.
- Treat any 5-minute-to-hello-world regression as a P0 bug across
  Windows, macOS, Linux.

Action items:
- [ ] Monthly clean-VM timing of the Quickstart on all 3 OSes.
- [ ] At least 2 recorded "watch a real dev onboard" sessions a year.

## 5. Find your tribe — don't fight for NestJS users

NestJS users are either happy or trapped; you won't convert them. Aim
at:

- Devs who *bounced off* NestJS because of decorator/DI complexity.
- TypeScript devs from Rails / Laravel / Django backgrounds — they
  *want* opinionated, convention-driven frameworks.
- Indie hackers / small teams building MVPs — they need speed and don't
  want to wire 14 packages together themselves.
- **AI-product builders** (chatbots, agents, AI-augmented SaaS) — your
  AI module is literally their problem.

Be where they already are: r/typescript, r/node, HN (sparingly), AI
engineering communities (LangChain Discord and similar), and the
MENA/Egyptian TypeScript community (natural distribution advantage —
use it).

## 6. Docs as an adoption engine

Docs are not an afterthought; they are the product's surface area for
everyone who hasn't installed it yet.

- **Diátaxis split, enforced.** Every page is exactly one of: Tutorial
  (hand-holding, no choices), How-to (recipe, assumes domain
  knowledge), Reference (dry, complete), or Concept/Explanation (the
  "why"). A page that does two of these does both badly.
- **Quickstart is the most important page in the entire project.**
- **Version the docs from the first stable release.** Mismatched
  docs-vs-installed-code destroys trust faster than missing docs.
- **Write docs right after the code, never before.** Docs for
  not-yet-stable APIs are aspirational fiction.
- **Examples > prose.** Reference pages: ~70% runnable code, ~30%
  "gotchas this hides." Reverse the usual ratio.
- **Keep the `skills/` AI-readable docs** alongside the human docs —
  see section 7. This is genuinely ahead of the curve; don't dismantle
  it.

## 7. AI discoverability (llms.txt and friends)

LLMs are now a primary docs consumer. When a developer asks Claude /
ChatGPT / Copilot "how do I do X in Warlock," the answer quality
depends on what those models can fetch.

- **`/llms.txt`** — a short roadmap file at the docs-site root
  (Jeremy Howard's proposed standard): project one-liner + curated
  links to key docs, grouped (Documentation / Reference / Optional).
  ~30 lines. Highest ROI item here.
- **`/llms-full.txt`** — the companion: every doc page concatenated
  into one big markdown file so large-context models ingest the whole
  thing in one fetch. Script this from the Docusaurus sources
  (Mintlify popularised the pattern).
- **`/robots.txt`** — explicitly *allow* `GPTBot`, `ClaudeBot`,
  `Google-Extended`, `CCBot`. Most projects block these by default,
  which is self-defeating: training exposure is free distribution.
- Add structured front-matter to each doc page
  (`kind: tutorial | how-to | reference | concept`, `weight`) so the
  bundle can be ordered intelligently.

Action items:
- [ ] Add `llms.txt` to the docs root (do this first — cheap, high
      impact).
- [ ] Build-step that generates `llms-full.txt` from the Docusaurus
      content.
- [ ] Audit `robots.txt`; allow the AI crawlers.

## 8. What NOT to do

- **No coordinated promotion / astroturfing.** Do not recruit friends
  who don't use the framework to post about it on
  dev.to/Reddit/LinkedIn. It is transparent, it gets you banned from
  the exact communities you need (r/typescript, r/node, HN), and it
  burns your friends' credibility too. If a friend genuinely builds
  something with Warlock and writes about *that*, that's word of mouth
  and it's gold — the difference is authenticity, and readers smell the
  difference instantly. Better ask: friends amplify *your* posts
  (a thoughtful reply, a share), they don't manufacture their own.
- No re-doing the logo / website chrome / README banner for the Nth
  time. It is not why people don't adopt.
- No defensive comparison tables vs other frameworks.
- No begging for stars.
- No chasing virality. Virality is luck; consistency is strategy.
- No adding more packages. There are enough. Harden, don't expand.

## 9. Expectations & timeline

Be realistic or you'll quit:

- Year 1: lucky to have ~100 stars and ~10 users you didn't personally
  recruit.
- AdonisJS launched 2015, took ~5 years to reach critical mass.
- Solid founded 2018, mainstream only ~2022-2023.

**Frameworks are decade-long bets.** If you expect a hockey stick in 12
months you'll be disappointed and stop. If you're aiming for "solid and
slightly known in 3-5 years," you're on track. The hard part isn't
knowing this playbook — it's executing it consistently for 5+ years.
The code work proved the work ethic exists; this is just a different
muscle.

## The one thing to do this week

Write the blog post: **"Why I built my own HMR for my TypeScript
backend framework."** Walk through the decisions — loader hooks,
`?v=N` cache busting, the flush protocol, the Windows path-normalisation
bug. The source material is already written in
`domains/core/how-it-works/how-does-dev-server-work.md`. It is the most
defensible technical story Warlock has right now; almost nobody has
built anything like it in a backend context. Publish it, post it to HN
once, and start the weekly cadence from there.
