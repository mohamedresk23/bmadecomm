import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

const isTest = process.env.NODE_ENV === "test";

function createDatabase() {
  if (isTest) {
    const client = new PGlite();
    return drizzlePglite(client, { schema });
  }

  const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/bmadecomm_dev";
  const client = postgres(connectionString);
  return drizzlePg(client, { schema });
}

export const db = createDatabase();
export type Database = typeof db;
