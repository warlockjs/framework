---
id: posts
since: 1.0
status: shipped
who: user
origin: confirmed
---

# Create and edit a post

A signed-in person writes a post with a title, a description and an image, and edits it later.

## Steps

1. route   POST /posts
2. route   PUT /posts/:id

## Cases

- invalid input   a post without a title or a description is refused and the answer names the field
- not allowed   only a signed-in person writes a post (AC-1)
- not found   editing a post that does not exist answers that it was not found
- duplicate   does not apply: two posts may share a title, the slug is made unique
- limits   does not apply: no size limit is set on a post
- expiry   does not apply: nothing expires
- double submit   does not apply: sending twice repeats the same request with the same result
- outside service down   does not apply: no outside service is called

## Acceptance criteria

- AC-1 Creating a post without signing in is refused.
