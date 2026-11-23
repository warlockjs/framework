---
id: direction
since: 1.0
status: shipped
who: developer
origin: confirmed
---

# Text and layout follow the reading direction

Inputs, labels and text start on the side the language reads from, and in Arabic the whole page is mirrored.

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

- AC-1 Inputs, labels and text align to the start of the reading direction (right in Arabic).
- AC-2 In Arabic the page is mirrored: the layout runs right to left.
