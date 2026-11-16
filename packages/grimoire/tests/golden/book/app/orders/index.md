# src/app/orders

Feature: orders. 8 files, 83 lines.

## Files
- controllers/place-order.controller.ts  controller  Answers a customer's request to place an order.
- events/order-placed.event.ts  event  Announces that an order was placed.
- jobs/send-receipt.job.ts  job  Sends the receipt after the payment settles.
- mails/order-confirmation.mail.ts  mail  Sends the order confirmation email.
- notifications/order-shipped.notification.ts  source  Tells the customer the order has shipped.
- routes.ts  routes  Registers the orders' HTTP routes.
- services/place-order.service.ts  service  Places an order and lowers the stock of its products.
- tests/place-order.test.ts  spec  Proves the place-order rules.

## Routes
- POST /api/orders
