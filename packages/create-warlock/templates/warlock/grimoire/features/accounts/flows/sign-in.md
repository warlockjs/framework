---
id: sign-in
since: 1.0
status: shipped
who: visitor
origin: confirmed
---

# Sign in

A person signs in with their email and password, keeps the session alive, reads their profile and signs out.

## Steps

1. route   POST /auth/login
2. route   POST /auth/refresh-token
3. route   GET /auth/me
4. route   POST /auth/logout
5. route   POST /auth/logout-all

## Cases

- invalid input   a wrong email or password is refused and the answer says which input to fix (AC-1)
- not allowed   the profile and the sign-out routes need a signed-in person (AC-2)
- not found   does not apply: the answer for an unknown email is the same as for a wrong password
- duplicate   does not apply: signing in twice opens two sessions
- limits   repeated failed sign-ins are throttled for that email
- expiry   an expired session is refreshed, or the person signs in again
- double submit   does not apply: sending twice repeats the same request with the same result
- outside service down   does not apply: no outside service is called

## Acceptance criteria

- AC-1 A wrong email or password is refused with a message naming what to fix.
- AC-2 A request for the profile without signing in is refused.
