import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../../../../db";
import { media } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../../../test-utils/db";

describe("Media Publish API", () => {
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  const privateDir = path.join(process.cwd(), "storage", "private");

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(privateDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(privateDir, { recursive: true }).catch(() => {});
    await db.delete(media);
  });

  afterEach(async () => {
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(privateDir, { recursive: true, force: true }).catch(() => {});
    await db.delete(media);
  });

  function createMockRequest(body: unknown, permissions: string[] = ["media:upload"]) {
    const headers = new Headers();
    if (permissions !== null) {
      headers.set("x-mock-user", JSON.stringify({ id: "test-user", roles: [], permissions }));
    }
    headers.set("Content-Type", "application/json");

    return new NextRequest("http://localhost/api/media/publish", {
      method: "POST",
      body: JSON.stringify(body),
      headers,
    });
  }

  it("publishes a pending media file", async () => {
    // 1. Setup pending media
    const id = "test_media_123";
    const filename = `${id}.jpg`;
    
    await db.insert(media).values({
      id,
      filename,
      mimeType: "image/jpeg",
      size: 1024,
      status: "pending",
    });

    await fs.writeFile(path.join(privateDir, filename), Buffer.from("fake-image-content"));

    // 2. Call publish
    const req = createMockRequest({ id });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.id).toBe(id);
    expect(data.url).toBe(`/uploads/${filename}`);

    // 3. Verify DB updated
    const dbRecord = await db.select().from(media).where(eq(media.id, id));
    expect(dbRecord[0].status).toBe("active");

    // 4. Verify file moved to public
    const publicStat = await fs.stat(path.join(uploadDir, filename));
    expect(publicStat.size).toBeGreaterThan(0);
  });

  it("returns 404 for unknown media", async () => {
    const req = createMockRequest({ id: "unknown" });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});
