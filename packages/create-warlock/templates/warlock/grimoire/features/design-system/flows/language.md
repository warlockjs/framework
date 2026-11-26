---
id: language
since: 1.0
status: shipped
who: visitor
origin: confirmed
---

# Switch the language

A visitor picks one of the languages the project offers and the site remembers the choice.

## Steps

1. route   POST /api/locale

## Cases

- invalid input   a language the project does not offer is refused and the answer names the field (AC-1)
- not allowed   does not apply: the switch is open to every visitor
- not found   does not apply: there is no record to find
- duplicate   does not apply: choosing the same language again changes nothing
- limits   does not apply: no limit is set
- expiry   does not apply: the choice is kept in a cookie with no end date
- double submit   does not apply: choosing twice stores the same value
- outside service down   does not apply: no outside service is called

## Acceptance criteria

- AC-1 A language the project does not offer is refused with a message naming the field.
