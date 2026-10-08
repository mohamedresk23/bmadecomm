import { afterEach, expect, it, vi } from "vitest";
import { postgresTestUrl } from "./index";

afterEach(() => vi.unstubAllEnvs());
it("requires a dedicated unambiguous PostgreSQL test destination", () => {
  vi.stubEnv("DATABASE_URL", "postgres://prod:secret@localhost:5432/production");
  for (const value of ["", "https://localhost:5432/dedicated_test", "postgres://localhost:5432/production",
    "postgres://localhost:5432/dedicated%5ftest", "postgres://localhost:5432/dedicated_test?host=elsewhere",
    "postgres://localhost,other:5432/dedicated_test", "postgres://localhost/dedicated_test"]) {
    vi.stubEnv("TEST_DATABASE_URL", value);
    expect(() => postgresTestUrl()).toThrow();
  }
  vi.stubEnv("TEST_DATABASE_URL", "postgres://tester@localhost:5432/dedicated_test");
  expect(postgresTestUrl()).toBe("postgres://tester@localhost:5432/dedicated_test");
});
it("rejects the same destination across credentials, aliases, case, queries and effective PGPORT", () => {
  vi.stubEnv("DATABASE_URL", "postgres://first:one@LOCALHOST:5432/shared_test");
  for (const value of ["postgresql://second:two@localhost:5432/shared_test",
    "postgres://tester@127.0.0.1:05432/shared_test", "postgres://tester@[::1]:5432/shared_test",
    "postgres://localhost:5432/shared_test?application_name=tests",
    "postgres://localhost:5432/shared_test?%68ost=other"]) {
    vi.stubEnv("TEST_DATABASE_URL", value);
    expect(() => postgresTestUrl()).toThrow();
  }
  vi.stubEnv("PGPORT", "55432");
  vi.stubEnv("DATABASE_URL", "postgresql://production@localhost/shared_test");
  vi.stubEnv("TEST_DATABASE_URL", "postgres://tester@localhost:55432/shared_test");
  expect(() => postgresTestUrl()).toThrow();
  vi.stubEnv("DATABASE_URL", "postgres://production@localhost/production");
  for (const port of ["0", "65536", "invalid", "5432junk"]) {
    vi.stubEnv("PGPORT", port);
    expect(() => postgresTestUrl()).toThrow();
  }
});
