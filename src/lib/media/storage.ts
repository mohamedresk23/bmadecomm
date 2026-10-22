import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export type RecoveryMetadata = { requestId?: string };
export type PublicCopy = { key: string; sha256: string; size: number };
export type QuarantinedCopy = PublicCopy & { recoveryPath: string };

export interface StorageAdapter {
  savePrivate(filename: string, buffer: Buffer, metadata?: RecoveryMetadata): Promise<void>;
  readPrivate(filename: string): Promise<Buffer>;
  publish(filename: string): Promise<string>;
  removePrivate(filename: string): Promise<void>;
  removePublic(filename: string): Promise<void>;
  inspectPublic(filename: string): Promise<PublicCopy | null>;
  quarantinePublic(filename: string, metadata?: RecoveryMetadata): Promise<QuarantinedCopy | null>;
  recordOrphan(filename: string, location?: "private" | "public", metadata?: RecoveryMetadata): Promise<void>;
}

export class LocalFileSystemAdapter implements StorageAdapter {
  private privateDir: string;
  private publicDir: string;
  private recoveryDir: string;

  constructor(root = process.cwd()) {
    this.recoveryDir = path.join(root, ".local");
    this.privateDir = path.join(root, "storage", "private");
    this.publicDir = path.join(root, "public", "uploads");
  }

  private key(filename: string) {
    if (filename.length > 255 || !/^[a-z0-9_-]+\.(jpg|png|webp)$/i.test(filename)) throw Object.assign(new Error("Invalid media key"), { code: "INVALID_MEDIA_KEY" });
    return filename;
  }
  private async publicBytes(filename: string): Promise<Buffer | null> {
    const source = path.join(this.publicDir, this.key(filename));
    try {
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error("Invalid public media object"), { code: "INVALID_PUBLIC_OBJECT" });
      return await fs.readFile(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async inspectPublic(filename: string): Promise<PublicCopy | null> {
    const bytes = await this.publicBytes(filename);
    return bytes === null ? null : { key: filename, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  }
  async quarantinePublic(filename: string, metadata?: RecoveryMetadata): Promise<QuarantinedCopy | null> {
    const bytes = await this.publicBytes(filename);
    if (bytes === null) return null;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const recoveryPath = path.join("storage", "catalog-quarantine", this.key(filename), sha256);
    const destination = path.join(this.privateDir, "..", "catalog-quarantine", filename, sha256);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const staging = `${destination}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(staging, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      // Atomic exclusive installation: an interrupted write cannot occupy the
      // content-addressed recovery path and poison future retries.
      try { await fs.link(staging, destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } catch (error) {
      await handle?.close().catch(() => {});
      throw error;
    } finally {
      await fs.rm(staging, { force: true });
    }
    // A previous interrupted attempt is reusable only after exact verification.
    if (!(await fs.readFile(destination)).equals(bytes)) throw Object.assign(new Error("Quarantine verification failed"), { code: "QUARANTINE_MISMATCH" });
    const record = { key: filename, sha256, size: bytes.length, recoveryPath };
    const log = await fs.open(path.join(this.privateDir, "..", "catalog-quarantine", "preservation.jsonl"), "a", 0o600);
    try {
      await log.writeFile(JSON.stringify({ ...record, requestId: metadata?.requestId, time: new Date().toISOString() }) + "\n");
      await log.sync();
    } finally { await log.close(); }
    const current = await this.publicBytes(filename);
    if (current === null) return record;
    if (!current.equals(bytes)) throw Object.assign(new Error("Public media changed during quarantine"), { code: "PUBLIC_COPY_CHANGED" });
    await this.removePublic(filename);
    return record;
  }
  async removePrivate(filename: string) { await fs.rm(path.join(this.privateDir, this.key(filename)), { force: true }); }
  async removePublic(filename: string) { await fs.rm(path.join(this.publicDir, this.key(filename)), { force: true }); }
  async recordOrphan(filename: string, location: "private" | "public" = "private", metadata?: RecoveryMetadata) {
    const key = this.key(filename);
    const results = await Promise.allSettled([
      (async () => {
        await fs.mkdir(this.recoveryDir, { recursive: true });
        await fs.appendFile(path.join(this.recoveryDir, "orphans.log"), JSON.stringify({ key, location, path: path.join(location === "private" ? this.privateDir : this.publicDir, key), requestId: metadata?.requestId, time: new Date().toISOString() }) + "\n");
      })(),
      (async () => {
        await fs.mkdir(this.privateDir, { recursive: true });
        await fs.appendFile(path.join(this.privateDir, "orphan-recovery.jsonl"), JSON.stringify({ key, location, time: new Date().toISOString() }) + "\n");
      })(),
    ]);
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  async readPrivate(filename: string): Promise<Buffer> {
    const filePath = path.join(this.privateDir, this.key(filename));
    return fs.readFile(filePath);
  }

  async savePrivate(filename: string, buffer: Buffer, metadata?: RecoveryMetadata): Promise<void> {
    await fs.mkdir(this.privateDir, { recursive: true });
    const filePath = path.join(this.privateDir, this.key(filename));
    const handle = await fs.open(filePath, "wx");
    try { await handle.writeFile(buffer); await handle.close(); }
    catch (error) {
      await handle.close().catch(() => {});
      try { await this.removePrivate(filename); } catch { await this.recordOrphan(filename, "private", metadata); }
      throw error;
    }
  }

  async publish(filename: string): Promise<string> {
    await fs.mkdir(this.publicDir, { recursive: true });
    const source = path.join(this.privateDir, this.key(filename));
    const dest = path.join(this.publicDir, this.key(filename));
    
    // Acquire ownership before copying so a collision never overwrites a
    // previously published object and compensation only removes our own key.
    const handle = await fs.open(dest, "wx");
    try { await handle.writeFile(await fs.readFile(source)); await handle.close(); }
    catch (error) {
      await handle.close().catch(() => {});
      try { await this.removePublic(filename); } catch { await this.recordOrphan(filename, "public"); }
      throw error;
    }
    // Note: We copy rather than rename in case we want to retain the private original
    // For local dev MVP, it's sufficient.
    
    return `/uploads/${filename}`;
  }
}

// In a real app, this would be injected or configured via environment variables
export const storage: StorageAdapter = new LocalFileSystemAdapter();
