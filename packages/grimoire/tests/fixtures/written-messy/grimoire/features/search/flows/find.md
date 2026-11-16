---
id: find
since: 1.0
status: building
who: customer
---

# Find a product


## Steps
1. page	/search
2. route   get /api/search -- the page calls it on every key press
3. affects   catalog

## Cases
* invalid input   an empty query shows nothing
* not allowed     does not apply: search is public
* Not Found       no match shows "nothing found"
* limits          at most 50 results, shown 10
                  at a time

## Not handled
- duplicate              does not apply: reading only
- expiry                 does not apply: nothing expires
- double submit          does not apply: reading only
- outside service down   does not apply: no outside service

Some notes the parser skips.

```md
## Not a heading
Unknown: inside a fence, not read
- AC-9   not a criterion
```

   Unknown: ranking by popularity or by date?

## Acceptance criteria
* AC-1   results list matching products
         first by name
- AC-2 [site]	the result count is shown
