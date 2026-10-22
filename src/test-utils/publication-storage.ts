import { afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalFileSystemAdapter, storage } from "../lib/media/storage";

/** Publication can withdraw files even on draft no-ops; never use deployment storage in tests. */
export function setupIsolatedPublicationStorage() {
  let root: string | undefined;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "publication-storage-"));
    const adapter = new LocalFileSystemAdapter(root);
    for (const method of ["inspectPublic", "quarantinePublic"] as const) vi.spyOn(storage, method).mockImplementation(adapter[method].bind(adapter));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (!root) return;
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe fixture root");
    await fs.rm(root, { recursive: true, force: true });
    root = undefined;
  });
}
