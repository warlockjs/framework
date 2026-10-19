# WR-013: AI tool discovery — searchable tool catalogue with lazy schemas (target 5.34)

Date: 2026-10-19 · Package: @warlock.js/ai · From: Bureau B9

**Today:** a large tool set costs tokens on every call. Bureau B9 built a stable core plus two meta-tools (search and
call). Search returns at most eight real schemas, and hidden tools stay callable under the same policy. Tool
definitions dropped from 31,919 to 4,307 characters.

**Request:** `ai.tools.catalogue({ core, searchable })` with search, lazy schema loading, and policy-checked calls of
hidden tools. Keep native provider tools outside it.
