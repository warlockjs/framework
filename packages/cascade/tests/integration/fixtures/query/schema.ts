/**
 * Postgres DDL for the query + persistence integration fixtures.
 *
 * Postgres has no schema-driven DDL in cascade, so the suites create these
 * tables themselves in `beforeAll` and reset rows per-test with `TRUNCATE`.
 *
 * Column naming follows what the driver actually writes:
 * - The Postgres driver's `modelDefaults` set `createdAtColumn` / `updatedAtColumn`
 *   to the snake_case `created_at` / `updated_at`, and the writer auto-stamps
 *   `created_at` on every insert — so those columns MUST exist with that exact
 *   name or the INSERT fails with "column does not exist".
 * - `deletedAtColumn` defaults to the camelCase `deletedAt` on the base Model
 *   (an initialized static, so the driver's snake_case default never overrides
 *   it). The soft-delete remover sets `{ $set: { deletedAt } }`, so the column
 *   is quoted camelCase to survive Postgres identifier folding.
 * - Other camelCase fields (`isActive`, `userId`) are written verbatim from the
 *   keys passed to `create`, so they are quoted camelCase here too.
 */
import { ARTICLES_TABLE, ORDERS_TABLE, USERS_TABLE } from "./models";

export const CREATE_USERS_TABLE = `
  CREATE TABLE "${USERS_TABLE}" (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    age INTEGER,
    role TEXT,
    city TEXT,
    "isActive" BOOLEAN,
    score NUMERIC,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  )
`;

export const CREATE_ORDERS_TABLE = `
  CREATE TABLE "${ORDERS_TABLE}" (
    id SERIAL PRIMARY KEY,
    "userId" INTEGER,
    status TEXT NOT NULL,
    amount NUMERIC,
    quantity INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  )
`;

export const CREATE_ARTICLES_TABLE = `
  CREATE TABLE "${ARTICLES_TABLE}" (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    views INTEGER,
    "deletedAt" TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  )
`;
