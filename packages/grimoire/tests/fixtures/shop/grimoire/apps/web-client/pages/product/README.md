---
route: /products/:id
layout: site
---

# Product

One product with its price, stock and the order button.

## Blocks
| Block        | Flow                     | Who sees it     | Changes with        |
| ------------ | ------------------------ | --------------- | ------------------- |
| Details      | catalog/browse-products  | everyone        | vip: member price   |
| Order button | orders/place-order       | customer        | —                   |
| Sign in hint | —                    | guest           | —                   |

## Also reached from
- mail   order-confirmation
