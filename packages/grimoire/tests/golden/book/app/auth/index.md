# src/app/auth

Feature: auth. 5 files, 35 lines.

## Files
- controllers/login.controller.ts  controller  Answers a login request.
- controllers/register.controller.ts  controller  Answers a sign-up request.
- routes.ts  routes  Registers the sign-up and login routes.
- services/login.service.ts  service  Checks a customer's email and password and opens a session.
- services/register.service.ts  service  Creates a customer account waiting for email verification.

## Routes
- POST /api/register
- POST /api/login
