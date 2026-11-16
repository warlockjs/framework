---
id: wishlist
since: 3.0
status: proposed
who: customer
---

# Save a product to the wishlist

## Steps
1. page           /products/:id
2. route          POST /api/wishlist
3. notification   wishlist-price-drop
4. page           /wishlist

## Differs by app
- mobile   the save button is also on the product card in lists

## Cases
- invalid input         the product does not exist → 404
- not allowed           guest → sent to sign in, then back to the product
- duplicate             already saved → stays saved, no error
- limits                at most 200 products
- expiry                does not apply: saved products do not expire
- double submit         two taps save once
- outside service down  does not apply: no outside service
- not found             a removed product disappears from the list

## Acceptance criteria
- AC-1            a saved product appears on /wishlist
- AC-2            saving twice keeps one entry
- AC-3            a guest is sent to sign in and returns to the product
- AC-4 [mobile]   the product card has a save button
