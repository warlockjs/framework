---
id: catalog
title: Product catalog
status: shipped
version: 2.1
updated: 2026-11-10
apps: [web-client, mobile]
folders: [src/app/catalog, src/web/$sites/client/products]
---

# Product catalog

Customers browse products, see what is new in their country, and will save products for later.

## Flows
- browse-products   list products and open one
- new-arrivals      the newest products sold in the customer's country
- wishlist          save a product for later

## Affects and affected by
- affected by orders/place-order (lowers stock)
