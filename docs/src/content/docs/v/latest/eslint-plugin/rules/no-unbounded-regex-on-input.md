---
title: no-unbounded-regex-on-input
description: Disallow unbounded regex quantifiers on request input, a ReDoS risk.
sidebar:
  order: 5
---

**Recommended:** error

A regex with an unbounded quantifier (`*`, `+`, `{n,}`) can take exponential
time to fail on a crafted input — `/^(a+)+$/` against `"aaaa…a!"` — and while it
backtracks the event loop serves nobody (ReDoS). The rule reports a regex
literal or `new RegExp("…")` with such a quantifier when it is applied to
request input: `regex.test(input)`, `regex.exec(input)`, and `input.match()`,
`matchAll()`, `replace()`, `replaceAll()`, `search()` and `split()` with the
regex. Regexes held in a local constant are followed.

This is deliberately simple: it does not prove a pattern is exponential, it
asks for a bound wherever the input is the client's.

## Incorrect

```ts
const EMAIL = /^\S+@\S+$/;
if (!EMAIL.test(request.input("email"))) throw new BadRequestError("Invalid email");
```

## Correct

```ts
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
if (!EMAIL.test(request.input("email"))) throw new BadRequestError("Invalid email");
```

Or cap the input length before matching, and prefer a Seal validator
(`v.string().email()`) for request validation.

## Options

`requestNames` — identifiers treated as the incoming request.
