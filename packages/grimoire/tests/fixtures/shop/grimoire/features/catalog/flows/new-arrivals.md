---
id: new-arrivals
since: 2.0
status: shipped
who: everyone
---

# New arrivals

The newest products sold in the shopper's country, newest first.

## Steps
1. page           /
2. route          GET /api/products/new-arrivals

## Differs by app
- mobile   uses the device's country when the customer has none

## Cases
- invalid input          an unknown country code → the global list
- not allowed            does not apply: public
- not found              no product in the country → the global list
- duplicate              does not apply: reading only
- limits                 at most 20 products
- expiry                 a product stays new for 30 days
- double submit          does not apply: reading only
- outside service down   does not apply: no outside service

## Acceptance criteria
- AC-1            the newest products come first
- AC-2            a customer with no country sees the global list
- AC-3 [mobile]   the device's country is used when the customer has none
