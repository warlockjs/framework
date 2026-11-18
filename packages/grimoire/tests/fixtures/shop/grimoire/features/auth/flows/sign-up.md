---
id: sign-up
since: 1.0
status: shipped
who: guest
origin: inferred
---

# Sign up

A guest creates an account to place orders.

## Steps
1. route   POST /api/register
2. job     delete-unverified — seven days later, if never verified

## Cases
- invalid input          a bad email → 422
- not allowed            does not apply: guests only
- duplicate              an email already used → 409
- expiry                 an unverified account is deleted after seven days

## Not handled
- not found              does not apply to the code as written
- limits                 no limit on sign-ups per address
- double submit          two quick submits create two accounts
- outside service down   the mail service down is not handled

## Acceptance criteria
- AC-1   a new account waits for email verification
- AC-2   an unverified account is deleted after seven days
