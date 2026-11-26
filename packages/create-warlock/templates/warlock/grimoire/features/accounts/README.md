---
id: accounts
title: Accounts and content
status: shipped
version: 1.0
updated: 2026-11-26
apps: [default]
folders: [src/app/auth, src/app/users, src/app/posts, src/app/uploads]
origin: confirmed
audience: [visitors, signed-in users, administrators]
---

# Accounts and content

People sign in, reset a forgotten password, write posts, upload files and, for administrators, manage users.

## Why

A new project starts with a working account system and content API, so the team extends it instead of building it first.

## Flows

- sign-in a person signs in, stays signed in, reads their profile and signs out
- reset-password a person who forgot their password gets a one-time code and chooses a new one
- posts a signed-in person creates and edits a post
- users an administrator lists users and adds one
- uploads anyone fetches an uploaded file

## Affects and affected by

- nothing yet: no other feature depends on these flows
