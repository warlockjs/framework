---
id: place-order
since: 1.0
status: shipped
who: customer
---

# Place an order

## Steps
1. page              /products/:id
2. route             POST /api/orders
3. outside service   payment gateway
4. event             order.placed
5. affects           catalog/browse-products — stock goes down
6. mail              order-confirmation
7. job               send-receipt
8. notification      order-shipped

## Differs by app
- mobile      pays with the device wallet
- web-admin   staff see the order in the orders list

## Cases
- invalid input          an empty cart → 422 with the reason
- not allowed            guest → sent to sign in
- not found              a product removed meanwhile → the order is refused
- duplicate              does not apply: each submit is a new order
- limits                 at most 50 products per order
- expiry                 a payment session expires after 15 minutes
- outside service down   the payment gateway is down → the order waits, the customer is told

## Not handled
- double submit   two quick submits can place two orders

Unknown: why does a vip skip the stock check?

## Acceptance criteria
- AC-1                the order is saved and the stock goes down
- AC-2                a product out of stock is refused
- AC-3                a customer places an order from the product page
- AC-4 [web-admin]    a new order appears first in the orders list
