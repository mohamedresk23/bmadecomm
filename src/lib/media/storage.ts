import fs from "node:fs/promises";
import path from "node:path";

export interface StorageAdapter {
  savePrivate(filename: string, buffer: Buffer): Promise<void>;
  publish(filename: string): Promise<string>;
}

export class LocalFileSystemAdapter implements StorageAdapter {
  private privateDir: string;
  private publicDir: string;

  constructor() {
    this.privateDir = path.join(process.cwd(), "storage", "private");
    this.publicDir = path.join(process.cwd(), "public", "uploads");
  }

  async savePrivate(filename: string, buffer: Buffer): Promise<void> {
    await fs.mkdir(this.privateDir, { recursive: true });
    const filePath = path.join(this.privateDir, filename);
    await fs.writeFile(filePath, buffer);
  }

  async publish(filename: string): Promise<string> {
    await fs.mkdir(this.publicDir, { recursive: true });
    const source = path.join(this.privateDir, filename);
    const dest = path.join(this.publicDir, filename);
    
    await fs.copyFile(source, dest);
    // Note: We copy rather than rename in case we want to retain the private original
    // For local dev MVP, it's sufficient.
    
    return `/uploads/${filename}`;
  }
}

// In a real app, this would be injected or configured via environment variables
export const storage: StorageAdapter = new LocalFileSystemAdapter();
