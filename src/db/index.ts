import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

const isTest = process.env.NODE_ENV === "test";
export const isPostgresTest = isTest && process.env.TEST_DATABASE_MODE === "postgres";

export function postgresTestUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error("PostgreSQL tests require explicit TEST_DATABASE_URL");
  function destination(raw: string, requirePort: boolean) {
    const url = new URL(raw);
    // postgres-js supports connection overrides and multihost syntax. Accept only
    // unambiguous destinations here rather than guessing where those connect.
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      /[% ,]/.test(url.hostname) || url.search || url.hash ||
      !/^\/[A-Za-z0-9_-]+$/.test(url.pathname) || (requirePort && !url.port))
      throw new Error("Test isolation requires an explicit, unambiguous PostgreSQL destination");
    const portText = url.port || process.env.PGPORT || "5432";
    const port = Number(portText);
    if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Test isolation requires a valid PostgreSQL port");
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const host = ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ? "loopback" : hostname;
    return { host, port, database: url.pathname.slice(1) };
  }
  const test = destination(value, true);
  if (!test.database.endsWith('_test')) throw new Error("TEST_DATABASE_URL must target a dedicated database ending in _test");
  if (process.env.DATABASE_URL) {
    const production = destination(process.env.DATABASE_URL, false);
    if (test.host === production.host && test.port === production.port && test.database === production.database)
      throw new Error("Test database must differ from DATABASE_URL");
  }
  return value;
}

function createDatabase() {
  if (isTest && !isPostgresTest) {
    const client = new PGlite();
    return drizzlePglite(client, { schema });
  }

  const connectionString = isPostgresTest ? postgresTestUrl() : process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/bmadecomm_dev";
  const client = postgres(connectionString);
  return drizzlePg(client, { schema });
}

export const db = createDatabase();
export type Database = typeof db;
