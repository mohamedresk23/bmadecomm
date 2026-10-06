import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FileSandboxEmailAdapter } from "./file-sandbox-adapter";

let temporary: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (temporary) {
    const target = path.resolve(temporary);
    if (!target.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(target).startsWith("bmadecomm-mail-test-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true });
  }
});
it("writes escaped private HTML with stable dedupe filenames under ignored .local", async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "bmadecomm-mail-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(temporary);
  const adapter = new FileSandboxEmailAdapter();
  const message = { to: '<script>"&', template: "customer-verification", data: { verificationUrl: "http://localhost:3000/verify-email#token=abc&user=123" }, idempotencyKey: "../../dedupe" };
  const first = await adapter.send(message); expect(await adapter.send(message)).toEqual(first);
  expect(adapter.directory).toBe(path.join(temporary, ".local", "sandbox-mail"));
  const files = await readdir(adapter.directory); expect(files).toHaveLength(1); expect(files[0]).toMatch(/^[a-f0-9]{64}\.html$/);
  const filename = path.join(adapter.directory, files[0]); const html = await readFile(filename, "utf8");
  expect(html).toContain("&lt;script&gt;&quot;&amp;"); expect(html).toContain("token=abc&amp;user=123"); expect(html).not.toContain("<script>");
  if (process.platform !== "win32") expect((await stat(filename)).mode & 0o777).toBe(0o600);
});
