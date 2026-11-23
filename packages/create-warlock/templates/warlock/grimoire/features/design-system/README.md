---
id: design-system
title: Design system
status: shipped
version: 1.0
updated: 2026-11-23
apps: [default]
folders: [src/web/dev]
origin: confirmed
audience: [developers, designers]
---

# Design system

The shared look and behaviour of every screen: reading direction, form controls and error messages.

## Why

Every screen in every language has to look right and say what went wrong. Describing the rules once lets each
feature point at them instead of repeating them.

## Flows

- direction text and layout follow the reading direction of the language
- components every form control renders in each language
- error-messages every error says what failed and what to do next

## Affects and affected by

- affects contact/send-message (its form controls, direction and error messages)
