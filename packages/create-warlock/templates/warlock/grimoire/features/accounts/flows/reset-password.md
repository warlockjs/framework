---
id: reset-password
since: 1.0
status: shipped
who: visitor
origin: confirmed
---

# Reset a forgotten password

A person who forgot their password asks for a one-time code and uses it to choose a new password.

## Steps

1. route   POST /auth/forgot-password
2. route   POST /auth/reset-password

## Cases

- invalid input   a missing email or code is refused and the answer names the field (AC-1)
- not allowed   does not apply: both steps are open to every visitor
- not found   does not apply: an unknown email gets the same answer as a known one, so nobody learns who has an account
- duplicate   does not apply: asking twice sends a new code and the old one stops working
- limits   requests are throttled by email and by address
- expiry   a code expires and the person asks for a new one
- double submit   does not apply: sending twice repeats the same request with the same result
- outside service down   does not apply: no outside service is called

## Acceptance criteria

- AC-1 A reset without the email, the code or the new password is refused with a message naming what is missing.
