---
id: error-messages
since: 1.0
status: shipped
who: developer
origin: confirmed
---

# Error messages say what failed and what to do next

Every error a person sees names what went wrong and the next step, next to the place where it happened.

## Steps

1. page   /dev/components

## Cases

- invalid input   does not apply: the page takes no input
- not allowed   does not apply: the page is for development only
- not found   does not apply: the page has no record to find
- duplicate   does not apply: nothing is saved
- limits   does not apply: no size limits
- expiry   does not apply: nothing expires
- double submit   does not apply: nothing is submitted
- outside service down   does not apply: no outside service is called
- server unreachable   does not apply: the page makes no request
- server error   does not apply: the page makes no request

## Acceptance criteria

- AC-1 Every error says what failed and what to do next.
