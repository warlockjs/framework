---
id: users
since: 1.0
status: shipped
who: administrator
origin: confirmed
---

# List and add users

An administrator lists the users of the project and adds a new one.

## Steps

1. route   GET /users
2. route   POST /users

## Cases

- invalid input   a user without an email or a password is refused and the answer names the field
- not allowed   only a signed-in administrator reaches these routes (AC-1)
- not found   does not apply: a list has no single record to find
- duplicate   adding a user with an email that is taken is refused
- limits   the list is paged
- expiry   does not apply: nothing expires
- double submit   does not apply: sending twice repeats the same request with the same result
- outside service down   does not apply: no outside service is called

## Acceptance criteria

- AC-1 Listing users without signing in is refused.
