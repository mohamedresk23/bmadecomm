import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { parse } from "dotenv";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupIdentity } from "./setup-identity";

const temporaryDirectories: string[] = [];
function temporaryFile(contents?: string) {
  const directory = mkdtempSync(join(tmpdir(), "registration-setup-"));
  temporaryDirectories.push(directory);
  const filename = join(directory, ".env.local");
  if (contents !== undefined) writeFileSync(filename, contents, { mode: 0o644 });
  return filename;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith("registration-setup-")) throw new Error("Unexpected setup test directory");
    rmSync(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("sandbox identity secret setup", () => {
  it.each(["export IDENTITY_TOKEN_KEY=existing\n", "  IDENTITY_TOKEN_KEY = existing\n", "IDENTITY_TOKEN_KEY=\n"])("refuses parsed existing keys without any file changes", contents => {
    const filename = temporaryFile(contents), before = statSync(filename);
    expect(() => setupIdentity(filename)).toThrow("already configured");
    expect(readFileSync(filename, "utf8")).toBe(contents);
    expect(statSync(filename).mode).toBe(before.mode);
    expect(statSync(filename).mtimeMs).toBe(before.mtimeMs);
  });
  it("preserves existing origin/adapter settings and generates a private key without output", () => {
    const filename = temporaryFile('export APP_URL = "http://localhost:4567"\n EMAIL_ADAPTER = sandbox\nOTHER=kept\n');
    const log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error");
    setupIdentity(filename);
    const settings = parse(readFileSync(filename));
    expect(settings.APP_URL).toBe("http://localhost:4567"); expect(settings.EMAIL_ADAPTER).toBe("sandbox");
    expect(settings.OTHER).toBe("kept"); expect(Buffer.from(settings.IDENTITY_TOKEN_KEY, "base64")).toHaveLength(32);
    expect(readFileSync(filename, "utf8").match(/APP_URL/g)).toHaveLength(1);
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    if (process.platform !== "win32") expect(statSync(filename).mode & 0o777).toBe(0o600);
  });
  it("adds missing sandbox settings to a new private file", () => {
    const filename = temporaryFile(); setupIdentity(filename);
    const settings = parse(readFileSync(filename));
    expect(settings.APP_URL).toBe("http://localhost:3000"); expect(settings.EMAIL_ADAPTER).toBe("sandbox");
    if (process.platform !== "win32") expect(statSync(filename).mode & 0o777).toBe(0o600);
  });
});
