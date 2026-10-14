import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import * as processor from "./image-process";

const effects = vi.hoisted(() => ({ savePrivate: vi.fn(), insert: vi.fn() }));
vi.mock("./storage", () => ({ storage: effects }));
vi.mock("../../db", () => ({ db: { insert: effects.insert } }));
import { processAndSaveMedia } from "./upload";

describe("production processing deadline", () => {
  it("kills an already-running noncooperative child after ten seconds before any persistence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "media-deadline-"));
    const worker = path.join(root, "busy.cjs");
    const marker = path.join(root, "started");
    // This simulates a decoder that never cooperates with cancellation. It is
    // not an image workload benchmark: the OS process must be terminated.
    await fs.writeFile(worker, [
      "const fs = require('node:fs');",
      "process.once('message', () => {",
      "  fs.writeFileSync(__dirname + '/started', String(process.pid));",
      "  while (true) {}",
      "});",
    ].join("\n"));
    const realProcess = processor.processImage;
    let exitedPid: number | undefined;
    const spy = vi.spyOn(processor, "processImage").mockImplementation((bytes, mime, signal) =>
      realProcess(bytes, mime, signal, { workerPath: worker, onExit: pid => { exitedPid = pid; } }),
    );
    try {
      const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
      const started = performance.now();
      await expect(processAndSaveMedia(new File([new Uint8Array(bytes)], "image.png", { type: "image/png" })))
        .rejects.toMatchObject({ statusCode: 408, code: "IMAGE_TIMEOUT" });
      expect(processor.IMAGE_PROCESSING_DEADLINE_MS).toBe(10_000);
      expect(performance.now() - started).toBeGreaterThanOrEqual(9_900);
      expect(Number(await fs.readFile(marker, "utf8"))).toBe(exitedPid);
      expect(() => process.kill(exitedPid!, 0)).toThrow();
      expect(effects.savePrivate).not.toHaveBeenCalled();
      expect(effects.insert).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      // Remove only this test's exact known files and now-empty directory.
      await fs.unlink(marker).catch(error => { if (error.code !== "ENOENT") throw error; });
      await fs.unlink(worker);
      await fs.rmdir(root);
    }
  }, 30_000);
});
