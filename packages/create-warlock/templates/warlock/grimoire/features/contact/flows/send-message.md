---
id: send-message
since: 1.0
status: shipped
who: guest
origin: confirmed
---

# Send a message

A visitor fills in the contact form on the home page and sends a message to the team.

## Steps

1. page   /
2. route   POST /api/contact

## Cases

- invalid input   a field is empty or wrong → the message is not sent and the field says what to fix (AC-2)
- not allowed   does not apply: the form is open to every visitor
- not found   does not apply: the form has no record to find
- duplicate   does not apply: sending twice sends two messages
- limits   does not apply: no limit is set
- expiry   does not apply: nothing expires
- double submit   does not apply: the button is disabled while a message is being sent
- outside service down   does not apply: no outside service is called
- server unreachable   the form keeps the text and says to check the connection (AC-3)
- server error   the form keeps the text and says to try again later (AC-4)

## Acceptance criteria

- AC-1 A valid message is sent and the form says so.
- AC-2 Invalid input is shown next to the field that is wrong.
- AC-3 When the server cannot be reached, the form keeps the text and says to check the connection.
- AC-4 When the server fails, the form keeps the text and says to try again later.
