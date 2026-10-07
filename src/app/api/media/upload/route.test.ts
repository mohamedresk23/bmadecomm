import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../../../../db";
import { media } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../../../test-utils/db";

describe("Media Upload API", () => {
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  const privateDir = path.join(process.cwd(), "storage", "private");

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    // Clean up upload dir
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(privateDir, { recursive: true, force: true }).catch(() => {});
    await db.delete(media); // clean db
  });

  afterEach(async () => {
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(privateDir, { recursive: true, force: true }).catch(() => {});
    await db.delete(media);
  });

  function createMockRequest(file: File, permissions: string[] = ["media:upload"]) {
    const formData = new FormData();
    formData.append("file", file);

    const headers = new Headers();
    if (permissions !== null) {
      headers.set("x-mock-user", JSON.stringify({ id: "test-user", roles: [], permissions }));
    }

    return new NextRequest("http://localhost/api/media/upload", {
      method: "POST",
      body: formData,
      headers,
    });
  }

  it("rejects unauthorized users with 403", async () => {
    const file = new File(["test"], "test.png", { type: "image/png" });
    const req = createMockRequest(file, []);
    
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("rejects oversized files with 413", async () => {
    // Create a 6MB file
    const largeBuffer = new Uint8Array(6 * 1024 * 1024);
    const file = new File([largeBuffer], "large.png", { type: "image/png" });
    const req = createMockRequest(file);

    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("rejects spoofed extension with 415", async () => {
    // Valid PDF magic bytes: %PDF-
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const file = new File([pdfBytes], "spoofed.png", { type: "image/png" });
    const req = createMockRequest(file);

    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it("accepts valid image and creates record", async () => {
    // Valid PNG magic bytes + some data
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, // ...
      0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, // IDAT
      0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, // ...
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82 // IEND
    ]);
    
    const file = new File([pngBytes], "test.png", { type: "image/png" });
    const req = createMockRequest(file);

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.status).toBe("pending");

    // Verify DB
    const dbRecord = await db.select().from(media).where(eq(media.id, data.id));
    expect(dbRecord.length).toBe(1);
    expect(dbRecord[0].mimeType).toBe("image/png");
    expect(dbRecord[0].status).toBe("pending");

    // Verify file exists in private storage
    const filename = `${data.id}.png`;
    const filePath = path.join(process.cwd(), "storage", "private", filename);
    const fileStat = await fs.stat(filePath);
    expect(fileStat.size).toBeGreaterThan(0);
  });
});
