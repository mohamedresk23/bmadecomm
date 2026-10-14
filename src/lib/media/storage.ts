import fs from "node:fs/promises";
import path from "node:path";

export interface StorageAdapter {
  savePrivate(filename: string, buffer: Buffer): Promise<void>;
  publish(filename: string): Promise<string>;
  removePrivate(filename: string): Promise<void>;
  removePublic(filename: string): Promise<void>;
  recordOrphan(filename: string, location?: "private" | "public"): Promise<void>;
}

export class LocalFileSystemAdapter implements StorageAdapter {
  private privateDir: string;
  private publicDir: string;

  constructor(root = process.cwd()) {
    this.privateDir = path.join(root, "storage", "private");
    this.publicDir = path.join(root, "public", "uploads");
  }

  private key(filename: string) {
    if (!/^[a-z0-9_-]+\.(jpg|png|webp)$/i.test(filename)) throw new Error("Invalid media key");
    return filename;
  }
  async removePrivate(filename: string) { await fs.rm(path.join(this.privateDir, this.key(filename)), { force: true }); }
  async removePublic(filename: string) { await fs.rm(path.join(this.publicDir, this.key(filename)), { force: true }); }
  async recordOrphan(filename: string, location: "private" | "public" = "private") {
    await fs.mkdir(this.privateDir, { recursive: true });
    await fs.appendFile(path.join(this.privateDir, "orphan-recovery.jsonl"), JSON.stringify({ key: this.key(filename), location, time: new Date().toISOString() }) + "\n");
  }

  async savePrivate(filename: string, buffer: Buffer): Promise<void> {
    await fs.mkdir(this.privateDir, { recursive: true });
    const filePath = path.join(this.privateDir, this.key(filename));
    const handle = await fs.open(filePath, "wx");
    try { await handle.writeFile(buffer); await handle.close(); }
    catch (error) {
      await handle.close().catch(() => {});
      try { await this.removePrivate(filename); } catch { await this.recordOrphan(filename); }
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
