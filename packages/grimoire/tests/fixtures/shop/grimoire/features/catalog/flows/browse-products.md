---
id: browse-products
since: 1.0
status: shipped
who: everyone
---

# Browse products

## Steps
1. route          GET /api/products
2. page           /products/:id
3. route          GET /api/products/:id — the page loads it through its setup file

## Cases
- invalid input          an unknown filter is ignored
- not allowed            does not apply: every product is public
- not found              an unknown product id → 404 page
- duplicate              does not apply: nothing is created
- limits                 50 products per page
- expiry                 does not apply: products do not expire
- double submit          does not apply: reading only
- outside service down   does not apply: no outside service

## Acceptance criteria
- AC-1            the list shows 50 products per page
- AC-2            an unknown product id shows the 404 page
- AC-3 [mobile]   the product screen shows the price in the device currency
