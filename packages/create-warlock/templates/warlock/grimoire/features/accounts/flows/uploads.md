---
id: uploads
since: 1.0
status: shipped
who: visitor
origin: confirmed
---

# Fetch an uploaded file

Anyone fetches a file that was uploaded, optionally as one of the image variants the project declares.

## Steps

1. route   GET /uploads/*

## Cases

- invalid input   does not apply: the route takes a path, not a form
- not allowed   does not apply: uploaded files are public
- not found   a path with no file behind it answers that it was not found (AC-1)
- duplicate   does not apply: the route only reads
- limits   only the image variants the project declares can be requested
- expiry   does not apply: nothing expires
- double submit   does not apply: sending twice repeats the same request with the same result
- outside service down   does not apply: no outside service is called

## Acceptance criteria

- AC-1 Asking for a file that does not exist answers that it was not found.
