# `v.string()` — method reference

Reference for `v.string()` / `v.email()`. Covers length, format, content, color, mutators (case, trim, mask, slug, base64, …) and what each maps to in JSON Schema.

For the picking guide (`v.string` vs `v.scalar` vs `v.literal`), see [`@warlock.js/seal/pick-seal-primitive/SKILL.md`](@warlock.js/seal/pick-seal-primitive/SKILL.md). For `.optional()` / `.nullable()` / `.default()` / `.in()` / `.oneOf()`, see [`@warlock.js/seal/compose-seal-modifiers/SKILL.md`](@warlock.js/seal/compose-seal-modifiers/SKILL.md).

## Length

| Method | Args | JSON Schema | Example |
|---|---|---|---|
| `.min(n, msg?)` | min length, inclusive | `minLength: n` | `v.string().min(3)` |
| `.minLength(n, msg?)` | alias for `.min()` | `minLength: n` | `v.string().minLength(3)` |
| `.max(n, msg?)` | max length, inclusive | `maxLength: n` | `v.string().max(120)` |
| `.maxLength(n, msg?)` | alias for `.max()` | `maxLength: n` | `v.string().maxLength(120)` |
| `.length(n, msg?)` | exact length | `minLength=maxLength=n` | `v.string().length(10)` |
| `.lengthBetween(a, b, msg?)` | min and max length | `minLength: a, maxLength: b` | `v.string().lengthBetween(5, 30)` |

## Format

| Method | Pattern | JSON Schema | Example |
|---|---|---|---|
| `.email(msg?)` | RFC-flavored regex | `format: "email"` | `v.string().email()` |
| `.url(msg?)` | http/https URL | `format: "uri"` | `v.string().url()` |
| `.pattern(re, msg?)` | custom regex | `pattern: re.source` | `v.string().pattern(/^[A-Z]/)` |
| `.alpha(msg?)` | letters only | — | `v.string().alpha()` |
| `.alphanumeric(msg?)` | letters + digits | — | `v.string().alphanumeric()` |
| `.numeric(msg?)` | digits only (string) | — | `v.string().numeric()` |
| `.withoutWhitespace(msg?)` | no spaces/tabs/newlines | — | `v.string().withoutWhitespace()` |
| `.creditCard(msg?)` | credit-card-shaped | — | `v.string().creditCard()` |
| `.ip(msg?)` | IPv4 or IPv6 | `format: "ipv4"` | `v.string().ip()` |
| `.ip4(msg?)` | IPv4 only | `format: "ipv4"` | `v.string().ip4()` |
| `.ip6(msg?)` | IPv6 only | `format: "ipv6"` | `v.string().ip6()` |
| `.strongPassword(minLen?, msg?)` | 8+ chars, upper+lower+digit+symbol | — | `v.string().strongPassword(12)` |

## ID formats

| Method | Args | JSON Schema | Example |
|---|---|---|---|
| `.uuid(version?, msg?)` | UUID, any version or restrict to 1/3/4/5/6/7 | `format: "uuid"` | `v.string().uuid(4)` |
| `.cuid({ version?: 1\|2 }?)` | CUID2 default (24 chars, lowercase); v1 legacy | `pattern: …` | `v.string().cuid()` |
| `.ulid(msg?)` | 26 chars, Crockford base32 (no I/L/O/U) | `pattern: …` | `v.string().ulid()` |
| `.nanoid(length?, msg?)` | URL-safe alphabet, default length 21 | `pattern: …` | `v.string().nanoid(21)` |

UUID validation is RFC 4122 strict — the variant nibble (8/9/a/b at position 17) is checked, so "looks-like-UUID-but-not-valid" inputs are rejected. CUID defaults to **CUID2** since CUID1 is deprecated by its original author; pass `{ version: 1 }` only for legacy data. nanoid's alphabet is fixed (`A-Za-z0-9_-`) — for custom alphabets use `.pattern()` directly.

## Word count

| Method | Args | Example |
|---|---|---|
| `.words(n, msg?)` | exact word count | `v.string().words(5)` |
| `.minWords(n, msg?)` | min words | `v.string().minWords(3)` |
| `.maxWords(n, msg?)` | max words | `v.string().maxWords(50)` |

## Content

| Method | Args | Example |
|---|---|---|
| `.startsWith(s, msg?)` | prefix check | `v.string().startsWith("https://")` |
| `.endsWith(s, msg?)` | suffix check | `v.string().endsWith(".pdf")` |
| `.contains(s, msg?)` | substring check | `v.string().contains("@")` |
| `.notContains(s, msg?)` | inverse substring | `v.string().notContains("javascript:")` |

## Color

| Method | Accepts | Example |
|---|---|---|
| `.color(msg?)` | any valid CSS color | `v.string().color()` |
| `.hexColor(msg?)` | `#rgb`, `#rrggbb` | `v.string().hexColor()` |
| `.rgbColor(msg?)` | `rgb(r,g,b)` | — |
| `.rgbaColor(msg?)` | `rgba(r,g,b,a)` | — |
| `.hslColor(msg?)` | `hsl(h,s,l)` | — |
| `.lightColor(msg?)` | luminance-based | — |
| `.darkColor(msg?)` | luminance-based | — |

JSON Schema: `format: "color"` for `.hexColor()`; the others map to `format: "color"` only via `.hexColor()` — for OpenAPI consumers expecting strict format, prefer `.hexColor()`.

## Case mutators (pre-validation)

| Method | Effect | Example |
|---|---|---|
| `.uppercase()` | "Hello" → "HELLO" | `v.string().uppercase()` |
| `.lowercase()` | "Hello" → "hello" | — |
| `.capitalize()` | "hello world" → "Hello world" | — |
| `.titleCase()` | "hello world" → "Hello World" | — |
| `.camelCase()` | "hello world" → "helloWorld" | — |
| `.pascalCase()` | "hello world" → "HelloWorld" | — |
| `.snakeCase()` | "hello world" → "hello_world" | — |
| `.kebabCase()` | "hello world" → "hello-world" | — |

## Trim & whitespace mutators

| Method | Args | Effect |
|---|---|---|
| `.trim(needle?)` | default = space | trim both ends |
| `.ltrim(needle?)` | — | trim left only |
| `.rtrim(needle?)` | — | trim right only |
| `.trimMultipleWhitespace()` | — | "a   b" → "a b" |
| `.padStart(len, char?)` | char default = " " | left-pad to length |
| `.padEnd(len, char?)` | char default = " " | right-pad to length |

## Replace, append, modify mutators

| Method | Args | Example |
|---|---|---|
| `.replace(search, replace)` | string or RegExp + string | — |
| `.replaceAll(search, replace)` | string or RegExp + string | — |
| `.append(suffix)` | string | "foo" → "foobar" via `.append("bar")` |
| `.prepend(prefix)` | string | "foo" → "barfoo" via `.prepend("bar")` |
| `.reverse()` | — | "abc" → "cba" |
| `.repeat(count)` | number | "ab" → "ababab" via `.repeat(3)` |
| `.truncate(maxLen, suffix?)` | suffix default = "…" | "long text" → "long…" |
| `.mask(start, end?, char?)` | char default = "*" | "1234567890" → "12******90" |

## Filter mutators

| Method | Effect |
|---|---|
| `.toAlpha()` | strip non-letters |
| `.toAlphanumeric()` | strip non-alphanumerics |
| `.removeSpecialCharacters()` | keep alphanumerics + whitespace |
| `.removeNumbers()` | strip digits |
| `.safeHtml()` | strip HTML tags |
| `.htmlEscape()` | `<` → `&lt;` etc |
| `.unescapeHtml()` | reverse `htmlEscape()` |

## Encoding mutators

| Method | Effect |
|---|---|
| `.base64Encode()` | utf8 → base64 |
| `.base64Decode()` | base64 → utf8 |
| `.urlEncode()` | percent-encode |
| `.urlDecode()` | percent-decode |
| `.slug()` | "Hello World!" → "hello-world" |
| `.toString()` | coerce non-string input to string |

## Mutator vs transformer

The methods above are **all mutators** — they reshape the value *before* validation rules run. If you want post-validation reshaping, attach via `.addTransformer(fn)` (see [`@warlock.js/seal/compose-seal-modifiers/SKILL.md`](@warlock.js/seal/compose-seal-modifiers/SKILL.md)).

Practical implication: `v.string().min(3).trim()` runs `min(3)` against the *un-trimmed* input. To check trimmed length, mutate first: `v.string().trim().min(3)`.

## Common chains

```ts
// Email field
v.string().email()

// Username
v.string().min(3).max(30).alphanumeric().lowercase()

// Slug from title
v.string().slug()

// Strong password
v.string().strongPassword(12)

// URL with strict format
v.string().url().startsWith("https://")

// Sanitized HTML body
v.string().safeHtml().min(1)

// Masked phone for response
v.string().pattern(/^\+\d{8,}$/).mask(3, -2)

// Optional with default
v.string().email().default("guest@example.com").optional()
```
