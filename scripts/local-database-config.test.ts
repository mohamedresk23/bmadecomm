import { expect, it } from "vitest";
import { localDatabaseUrl } from "./local-database-config";

it("only permits dedicated loopback development PostgreSQL", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "development", DATABASE_URL: "postgres://bmadecomm_dev:synthetic@127.0.0.1:5432/bmadecomm_dev" };
  expect(!!localDatabaseUrl(env)).toBe(true);
  for (const DATABASE_URL of ["postgres://postgres:synthetic@127.0.0.1/postgres", "postgres://bmadecomm_dev:synthetic@remote.test/bmadecomm_dev", "postgres://bmadecomm_dev:synthetic@127.0.0.1/production", "postgres://bmadecomm_dev@127.0.0.1/bmadecomm_dev", "postgres://bmadecomm_dev:synthetic@127.0.0.1/bmadecomm_dev?search_path=public", "file:local"]) {
    expect(() => localDatabaseUrl({ ...env, DATABASE_URL })).toThrow();
  }
  for (const NODE_ENV of ["production", "test"] as const) expect(() => localDatabaseUrl({ ...env, NODE_ENV })).toThrow();
});
