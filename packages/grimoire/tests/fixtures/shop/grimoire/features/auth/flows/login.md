---
id: login
since: 1.0
status: shipped
who: guest
origin: inferred
---

# Log in

## Steps
1. route   POST /api/login

## Cases
- invalid input   a missing password → 422
- not allowed     an unverified account → 403
- not found       an unknown email → the same message as a wrong password

## Not handled
- duplicate              does not apply: no record is created
- limits                 no limit on attempts
- expiry                 sessions never expire
- double submit          does not apply: idempotent
- outside service down   does not apply: no outside service

Unknown: should sessions expire?

## Acceptance criteria
- AC-1   valid credentials open a session
