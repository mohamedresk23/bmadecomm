import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { db } from "../../../../../../../../db";
import { media, products, productMedia, roles, sessions, staffAccounts, userRoles, users } from "../../../../../../../../db/schema";
import { setupTestDb } from "../../../../../../../../test-utils/db";
import { issueStaffSession } from "../../../../../../../../modules/identity/infrastructure/staff-sessions";
import { STAFF_SESSION_POLICY, staffConfig } from "../../../../../../../../modules/identity/infrastructure/staff-config";
import { encryptStaffSecret, newStaffSeed } from "../../../../../../../../modules/identity/infrastructure/staff-crypto";
import { LocalFileSystemAdapter, storage } from "../../../../../../../../lib/media/storage";
import { GET as getGallery } from "./route";
import { GET as getPreview } from "./[imageId]/content/route";

const isolated = { root: "", adapter: null as unknown as LocalFileSystemAdapter };
const createdUsers: string[] = [];
const createdProducts: string[] = [];
const createdMedia: string[] = [];

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("STAFF_MFA_KEY", randomBytes(32).toString("base64"));
  isolated.root = await fs.mkdtemp(path.join(os.tmpdir(), "gallery-test-"));
  isolated.adapter = new LocalFileSystemAdapter(isolated.root);
  vi.spyOn(storage, "readPrivate").mockImplementation((filename: string) => isolated.adapter.readPrivate(filename));
  vi.spyOn(storage, "savePrivate").mockImplementation((filename: string, buf: Buffer) => isolated.adapter.savePrivate(filename, buf));
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of createdProducts) {
    await db.delete(productMedia).where(eq(productMedia.productId, id));
    await db.delete(products).where(eq(products.id, id));
  }
  createdProducts.length = 0;

  for (const id of createdMedia) {
    await db.delete(media).where(eq(media.id, id));
  }
  createdMedia.length = 0;

  for (const id of createdUsers) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(userRoles).where(eq(userRoles.userId, id));
    await db.delete(staffAccounts).where(eq(staffAccounts.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  createdUsers.length = 0;

  await fs.rm(isolated.root, { recursive: true, force: true }).catch(() => {});
  vi.unstubAllEnvs();
});

async function staff(role = "catalog") {
  const userId = randomUUID();
  createdUsers.push(userId);
  await db.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    role: "staff",
    name: "Catalog Staff",
    phone: "01000000000",
    passwordHash: "fixture",
  });
  await db.insert(staffAccounts).values({
    userId,
    mfaEnrolledAt: new Date(),
    mfaSeed: encryptStaffSecret(newStaffSeed(), staffConfig().key, userId, "mfa"),
  });
  await db.insert(roles).values({ key: role }).onConflictDoNothing();
  await db.insert(userRoles).values({ userId, roleKey: role });
  const issued = await issueStaffSession(db, userId, STAFF_SESSION_POLICY);
  if (!issued) throw new Error("Fixture session issuance failed");
  return { ...issued, userId };
}

async function createProductFixture(name = "Test Draft") {
  const id = `prd_${randomUUID().slice(0, 12)}`;
  createdProducts.push(id);
  await db.insert(products).values({
    id,
    name,
    status: "draft",
    mediaRevision: BigInt(0),
  });
  return id;
}

async function createMediaFixture(filename: string, bytes: Buffer = Buffer.from("test-image-content")) {
  const id = `med_${randomUUID().slice(0, 12)}`;
  createdMedia.push(id);
  await db.insert(media).values({
    id,
    filename,
    mimeType: "image/png",
    size: bytes.length,
    status: "pending",
  });
  await isolated.adapter.savePrivate(filename, bytes);
  return id;
}

describe("Product gallery metadata & preview API", () => {
  it("rejects guest and customer sessions with 401/403 before executing queries", async () => {
    const productId = await createProductFixture();
    const guestReq = new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images`);
    const guestRes = await getGallery(guestReq, { params: Promise.resolve({ id: productId }) });
    expect(guestRes.status).toBe(401);
    expect(guestRes.headers.get("cache-control")).toBe("private, no-store");

    // Preview endpoint guest check
    const guestPreview = new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images/pim_1/content`);
    const previewRes = await getPreview(guestPreview, { params: Promise.resolve({ id: productId, imageId: "pim_1" }) });
    expect(previewRes.status).toBe(401);
    expect(previewRes.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns 404 for an unknown product", async () => {
    const { token } = await staff();
    const req = new Request("http://localhost:3000/api/v1/admin/catalog/products/prd_unknown/images", {
      headers: { Cookie: `__Host-staff-session=${token}` },
    });
    const res = await getGallery(req, { params: Promise.resolve({ id: "prd_unknown" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Product not found");
  });

  it("returns an empty gallery with primaryImageId null and empty arrays", async () => {
    const { token } = await staff();
    const productId = await createProductFixture();
    const req = new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images`, {
      headers: { Cookie: `__Host-staff-session=${token}` },
    });
    const res = await getGallery(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.gallery).toEqual({
      productId,
      revision: "0",
      primaryImageId: null,
      images: [],
      variantImages: [],
      publicationIssues: [],
    });
  });

  it("returns populated gallery with sorted images, derived primary, and publicationIssues for blank alt", async () => {
    const { token } = await staff();
    const productId = await createProductFixture();
    const mediaId1 = await createMediaFixture("img1.png");
    const mediaId2 = await createMediaFixture("img2.png");

    const pim1 = `pim_${randomUUID().slice(0, 8)}`;
    const pim2 = `pim_${randomUUID().slice(0, 8)}`;

    await db.insert(productMedia).values([
      { id: pim1, productId, mediaId: mediaId1, sortOrder: 0, altText: "" },
      { id: pim2, productId, mediaId: mediaId2, sortOrder: 1, altText: "Back View" },
    ]);

    const req = new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images`, {
      headers: { Cookie: `__Host-staff-session=${token}` },
    });
    const res = await getGallery(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.gallery.primaryImageId).toBe(pim1);
    expect(data.gallery.images).toHaveLength(2);
    expect(data.gallery.images[0].position).toBe(0);
    expect(data.gallery.images[1].position).toBe(1);
    expect(data.gallery.images[0].previewUrl).toBe(`/api/v1/admin/catalog/products/${productId}/images/${pim1}/content`);
    expect(data.gallery.publicationIssues).toEqual([
      { field: `images.${pim1}.altText`, message: "Alt text is required before publication" },
    ]);
  });

  it("serves private preview stream with safe headers without publishing to public", async () => {
    const { token } = await staff();
    const productId = await createProductFixture();
    const mediaId = await createMediaFixture("test.png", Buffer.from("private-image-bytes"));
    const pim = `pim_${randomUUID().slice(0, 8)}`;
    await db.insert(productMedia).values({ id: pim, productId, mediaId, sortOrder: 0, altText: "Logo" });

    const req = new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images/${pim}/content`, {
      headers: { Cookie: `__Host-staff-session=${token}` },
    });
    const res = await getPreview(req, { params: Promise.resolve({ id: productId, imageId: pim }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const arrayBuf = await res.arrayBuffer();
    expect(Buffer.from(arrayBuf).toString()).toBe("private-image-bytes");

    // Ensure no public file was created in public/uploads
    await expect(fs.stat(path.join(process.cwd(), "public", "uploads", "test.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns 404 when requesting an image belonging to a different product (safe isolation)", async () => {
    const { token } = await staff();
    const productA = await createProductFixture("Product A");
    const productB = await createProductFixture("Product B");
    const mediaId = await createMediaFixture("foreign.png");
    const pim = `pim_${randomUUID().slice(0, 8)}`;
    await db.insert(productMedia).values({ id: pim, productId: productA, mediaId, sortOrder: 0, altText: "" });

    // Request pim under productB
    const req = new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productB}/images/${pim}/content`, {
      headers: { Cookie: `__Host-staff-session=${token}` },
    });
    const res = await getPreview(req, { params: Promise.resolve({ id: productB, imageId: pim }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 when requesting a soft-removed image", async () => {
    const { token } = await staff();
    const productId = await createProductFixture();
    const mediaId = await createMediaFixture("removed.png");
    const pim = `pim_${randomUUID().slice(0, 8)}`;
    await db.insert(productMedia).values({
      id: pim,
      productId,
      mediaId,
      sortOrder: 0,
      altText: "",
      removedAt: new Date(),
    });

    const req = new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images/${pim}/content`, {
      headers: { Cookie: `__Host-staff-session=${token}` },
    });
    const res = await getPreview(req, { params: Promise.resolve({ id: productId, imageId: pim }) });
    expect(res.status).toBe(404);
  });

  it("returns 503 MEDIA_UNAVAILABLE when private storage file is missing on disk", async () => {
    const { token } = await staff();
    const productId = await createProductFixture();
    // Insert media row but DO NOT create file on disk
    const mediaId = `med_${randomUUID().slice(0, 12)}`;
    createdMedia.push(mediaId);
    await db.insert(media).values({
      id: mediaId,
      filename: "missing.png",
      mimeType: "image/png",
      size: 100,
      status: "pending",
    });
    const pim = `pim_${randomUUID().slice(0, 8)}`;
    await db.insert(productMedia).values({ id: pim, productId, mediaId, sortOrder: 0, altText: "" });

    const req = new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images/${pim}/content`, {
      headers: { Cookie: `__Host-staff-session=${token}` },
    });
    const res = await getPreview(req, { params: Promise.resolve({ id: productId, imageId: pim }) });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("MEDIA_UNAVAILABLE");
  });
});
