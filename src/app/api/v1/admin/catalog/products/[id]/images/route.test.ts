import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { db } from "../../../../../../../../db";
import {
  auditEvents,
  media,
  operationKeys,
  products,
  productMedia,
  roles,
  sessions,
  staffAccounts,
  uploadRateBuckets,
  userRoles,
  users,
} from "../../../../../../../../db/schema";
import { setupTestDb } from "../../../../../../../../test-utils/db";
import { issueStaffSession } from "../../../../../../../../modules/identity/infrastructure/staff-sessions";
import { STAFF_SESSION_POLICY, staffConfig } from "../../../../../../../../modules/identity/infrastructure/staff-config";
import { encryptStaffSecret, newStaffSeed, sessionCsrf } from "../../../../../../../../modules/identity/infrastructure/staff-crypto";
import { LocalFileSystemAdapter, storage } from "../../../../../../../../lib/media/storage";
import * as auditModule from "../../../../../../../../shared/authz/audit";
import { GET as getGallery, POST as postImage } from "./route";
import { GET as getPreview } from "./[imageId]/content/route";
import { POST as publishImage } from "../../../../../../media/publish/route";

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
  vi.spyOn(storage, "removePrivate").mockImplementation((filename: string) => isolated.adapter.removePrivate(filename));
  vi.spyOn(storage, "recordOrphan").mockImplementation((filename: string, loc) => isolated.adapter.recordOrphan(filename, loc));
  vi.spyOn(storage, "publish").mockImplementation((filename: string) => isolated.adapter.publish(filename));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(uploadRateBuckets);
  await db.delete(operationKeys);

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
  const csrf = sessionCsrf(issued.token, staffConfig().key);
  return { ...issued, userId, csrf };
}

async function createProductFixture(name = "Test Draft", status: "draft" | "published" | "archived" = "draft") {
  const id = `prd_${randomUUID().slice(0, 12)}`;
  createdProducts.push(id);
  await db.insert(products).values({
    id,
    name,
    status,
    mediaRevision: BigInt(0),
  });
  return id;
}

async function createMediaFixture(filename: string, bytes: Buffer = Buffer.from("test-image-content"), id = `med_${randomUUID().slice(0, 12)}`) {
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

async function createValidImageBytes(width = 10, height = 10, format: "png" | "jpeg" | "webp" = "png") {
  return sharp({ create: { width, height, channels: 3, background: "blue" } })
    .toFormat(format)
    .toBuffer();
}

describe("generic publication of Draft product media", () => {
  it.each([
    { status: "pending", removed: false },
    { status: "active", removed: false },
    { status: "pending", removed: true },
  ])("rejects $status Draft media (removed=$removed) without public storage or mutation", async ({ status, removed }) => {
    const { token, csrf } = await staff("owner");
    const productId = await createProductFixture();
    const filename = `${randomUUID()}.png`;
    const mediaId = await createMediaFixture(filename, Buffer.from("test-image-content"), randomUUID().replaceAll("-", ""));
    await db.update(media).set({ status }).where(eq(media.id, mediaId));
    if (status === "active") await isolated.adapter.publish(filename);
    const publishedOwner = await createProductFixture("Shared published owner", "published");
    await db.insert(productMedia).values({
      id: randomUUID(), productId: publishedOwner, mediaId, sortOrder: 0,
    });
    await db.insert(productMedia).values({
      id: randomUUID(), productId, mediaId, sortOrder: 0,
      removedAt: removed ? new Date() : null,
    });

    const response = await publishImage(new Request(`${staffConfig().origin}/api/media/publish`, {
      method: "POST",
      headers: {
        Origin: staffConfig().origin,
        Cookie: `__Host-staff-session=${token}`,
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: mediaId }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: {
      code: "CONFLICT",
      message: "Draft product media cannot be published through generic publish endpoint",
    } });
    expect(storage.publish).not.toHaveBeenCalled();
    expect((await db.select().from(media).where(eq(media.id, mediaId)))[0].status).toBe(status);
    expect(await isolated.adapter.readPrivate(filename)).toEqual(Buffer.from("test-image-content"));
    const publicPath = path.join(isolated.root, "public/uploads", filename);
    if (status === "active") {
      expect(await fs.readFile(publicPath)).toEqual(Buffer.from("test-image-content"));
    } else {
      await expect(fs.stat(publicPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});

function makeUploadRequest(
  productId: string,
  token: string | null,
  csrf: string | null,
  key: string | null,
  fileBytes: Buffer,
  filename = "test.png",
  mimeType = "image/png"
) {
  const formData = new FormData();
  formData.append("file", new File([new Uint8Array(fileBytes)], filename, { type: mimeType }));
  const headers: Record<string, string> = {};
  if (token) headers["Cookie"] = `__Host-staff-session=${token}`;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (key !== null) headers["Idempotency-Key"] = key;

  return new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images`, {
    method: "POST",
    headers,
    body: formData,
  });
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

describe("POST /api/v1/admin/catalog/products/[id]/images - Upload draft image", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const productId = await createProductFixture();
    const imageBytes = await createValidImageBytes();
    const req = makeUploadRequest(productId, null, null, "key-auth-1", imageBytes);
    const res = await postImage(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(401);
  });

  it("rejects non-catalog staff sessions with 403", async () => {
    const { token, csrf } = await staff("order_manager");
    const productId = await createProductFixture();
    const imageBytes = await createValidImageBytes();
    const req = makeUploadRequest(productId, token, csrf, "key-role-1", imageBytes);
    const res = await postImage(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("rejects invalid or missing CSRF token with 403", async () => {
    const { token } = await staff("catalog");
    const productId = await createProductFixture();
    const imageBytes = await createValidImageBytes();
    const req = makeUploadRequest(productId, token, "invalid-csrf", "key-csrf-1", imageBytes);
    const res = await postImage(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("rejects missing, empty, or oversized Idempotency-Key with 400", async () => {
    const { token, csrf } = await staff("catalog");
    const productId = await createProductFixture();
    const imageBytes = await createValidImageBytes();

    // Missing key
    const req1 = makeUploadRequest(productId, token, csrf, null, imageBytes);
    const res1 = await postImage(req1, { params: Promise.resolve({ id: productId }) });
    expect(res1.status).toBe(400);

    // Empty key
    const req2 = makeUploadRequest(productId, token, csrf, "", imageBytes);
    const res2 = await postImage(req2, { params: Promise.resolve({ id: productId }) });
    expect(res2.status).toBe(400);

    // Oversized key (> 128 bytes)
    const longKey = "a".repeat(129);
    const req3 = makeUploadRequest(productId, token, csrf, longKey, imageBytes);
    const res3 = await postImage(req3, { params: Promise.resolve({ id: productId }) });
    expect(res3.status).toBe(400);
  });

  it("rejects upload when product status is not draft with 409 Conflict", async () => {
    const { token, csrf } = await staff("catalog");
    const publishedProduct = await createProductFixture("Published Prd", "published");
    const imageBytes = await createValidImageBytes();

    const req = makeUploadRequest(publishedProduct, token, csrf, "key-status-1", imageBytes);
    const res = await postImage(req, { params: Promise.resolve({ id: publishedProduct }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("draft");
  });

  it("successfully uploads a draft image (201), assigns position 0, increments revision to 1, writes audit log, and saves private file", async () => {
    const { token, csrf, userId } = await staff("catalog");
    const productId = await createProductFixture("Draft Prd 1");
    const imageBytes = await createValidImageBytes(20, 20, "png");

    const req = makeUploadRequest(productId, token, csrf, "key-upload-1", imageBytes, "sample.png", "image/png");
    const res = await postImage(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.image).toBeTruthy();
    expect(data.image.position).toBe(0);
    expect(data.image.mimeType).toBe("image/png");
    expect(data.gallery.revision).toBe("1");
    expect(data.gallery.primaryImageId).toBe(data.image.id);
    expect(data.gallery.images).toHaveLength(1);

    // Verify DB product_media
    const attachments = await db.select().from(productMedia).where(eq(productMedia.productId, productId));
    expect(attachments).toHaveLength(1);
    expect(attachments[0].sortOrder).toBe(0);

    // Verify DB products media_revision
    const [prod] = await db.select().from(products).where(eq(products.id, productId));
    expect(prod.mediaRevision).toBe(BigInt(1));

    // Verify audit log
    const auditRows = await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${productId}`));
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const attachAudit = auditRows.find((a) => a.action === "catalog.product.image.attach");
    expect(attachAudit).toBeTruthy();
    expect(attachAudit?.actor).toBe(`staff:${userId}`);

    // Verify private storage file exists
    const [mediaRow] = await db.select().from(media).where(eq(media.id, attachments[0].mediaId));
    expect(mediaRow).toBeTruthy();
    const fileBytes = await isolated.adapter.readPrivate(mediaRow.filename);
    expect(fileBytes.length).toBeGreaterThan(0);
  });

  it("successive upload appends at position 1 and increments revision to 2", async () => {
    const { token, csrf } = await staff("catalog");
    const productId = await createProductFixture("Draft Prd 2");
    const image1 = await createValidImageBytes(10, 10, "png");
    const image2 = await createValidImageBytes(15, 15, "png");

    const req1 = makeUploadRequest(productId, token, csrf, "key-seq-1", image1, "first.png", "image/png");
    const res1 = await postImage(req1, { params: Promise.resolve({ id: productId }) });
    expect(res1.status).toBe(201);

    const req2 = makeUploadRequest(productId, token, csrf, "key-seq-2", image2, "second.png", "image/png");
    const res2 = await postImage(req2, { params: Promise.resolve({ id: productId }) });
    expect(res2.status).toBe(201);
    const data2 = await res2.json();
    expect(data2.image.position).toBe(1);
    expect(data2.gallery.revision).toBe("2");
    expect(data2.gallery.images).toHaveLength(2);
  });

  it("idempotent replay returns cached 201 without duplicate attachments, extra revision, or extra audit events", async () => {
    const { token, csrf } = await staff("catalog");
    const productId = await createProductFixture("Draft Prd Idemp");
    const imageBytes = await createValidImageBytes(25, 25, "png");

    const req1 = makeUploadRequest(productId, token, csrf, "key-replay-1", imageBytes, "replay.png", "image/png");
    const res1 = await postImage(req1, { params: Promise.resolve({ id: productId }) });
    expect(res1.status).toBe(201);
    const data1 = await res1.json();

    // Replay with identical key and identical file bytes
    const req2 = makeUploadRequest(productId, token, csrf, "key-replay-1", imageBytes, "replay.png", "image/png");
    const res2 = await postImage(req2, { params: Promise.resolve({ id: productId }) });
    expect(res2.status).toBe(201);
    const data2 = await res2.json();

    expect(data2).toEqual(data1);

    // Verify DB: exactly 1 attachment, 1 audit event, revision 1
    const attachments = await db.select().from(productMedia).where(eq(productMedia.productId, productId));
    expect(attachments).toHaveLength(1);

    const auditRows = await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${productId}`));
    expect(auditRows.filter((a) => a.action === "catalog.product.image.attach")).toHaveLength(1);

    const [prod] = await db.select().from(products).where(eq(products.id, productId));
    expect(prod.mediaRevision).toBe(BigInt(1));
  });

  it("reused idempotency key with different file bytes returns 409 Conflict (payload mismatch)", async () => {
    const { token, csrf } = await staff("catalog");
    const productId = await createProductFixture("Draft Prd Mismatch");
    const image1 = await createValidImageBytes(20, 20, "png");
    const image2 = await createValidImageBytes(30, 30, "png");

    const req1 = makeUploadRequest(productId, token, csrf, "key-mismatch-1", image1, "img1.png", "image/png");
    const res1 = await postImage(req1, { params: Promise.resolve({ id: productId }) });
    expect(res1.status).toBe(201);

    const req2 = makeUploadRequest(productId, token, csrf, "key-mismatch-1", image2, "img2.png", "image/png");
    const res2 = await postImage(req2, { params: Promise.resolve({ id: productId }) });
    expect(res2.status).toBe(409);
    const body = await res2.json();
    expect(body.error.message).toContain("payload mismatch");
  });

  it("expired idempotency key (> 24 hours) returns 409 Conflict and rejects reuse", async () => {
    const { token, csrf, userId } = await staff("catalog");
    const productId = await createProductFixture("Draft Prd Expired");
    const imageBytes = await createValidImageBytes(10, 10, "png");

    const expiredDate = new Date(Date.now() - 25 * 3600 * 1000);
    await db.insert(operationKeys).values({
      id: randomUUID(),
      actor: `staff:${userId}`,
      operation: `catalog.product.image.upload:${productId}`,
      key: "key-expired-1",
      payloadHash: createHash("sha256").update("dummy").digest("hex"),
      completedAt: expiredDate,
      createdAt: expiredDate,
      result: { success: true },
    });

    const req = makeUploadRequest(productId, token, csrf, "key-expired-1", imageBytes);
    const res = await postImage(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("expired");
  });

  it("enforces maximum capacity of 10 active attachments with 422 Unprocessable Entity", async () => {
    const { token, csrf } = await staff("catalog");
    const productId = await createProductFixture("Draft Prd 10");

    // Seed 10 active attachments
    for (let i = 0; i < 10; i++) {
      const mediaId = await createMediaFixture(`img_${i}.png`);
      await db.insert(productMedia).values({
        id: `pim_cap_${i}`,
        productId,
        mediaId,
        sortOrder: i,
        altText: `Image ${i}`,
      });
    }

    const imageBytes = await createValidImageBytes(10, 10, "png");
    const req = makeUploadRequest(productId, token, csrf, "key-cap-11", imageBytes);
    const res = await postImage(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.message).toContain("10 active images");

    // Verify product still has exactly 10 attachments
    const attachments = await db.select().from(productMedia).where(eq(productMedia.productId, productId));
    expect(attachments).toHaveLength(10);
  });

  it("enforces staff rate limit of 20 attempts per 10 minutes with 429 and Retry-After header", async () => {
    const { token, csrf, userId } = await staff("catalog");
    const productId = await createProductFixture("Draft Prd RateLimit");

    // Seed upload rate bucket with 20 attempts using correct hash key
    const rateKey = createHash("sha256").update(JSON.stringify(["staff_upload", userId])).digest("hex");
    await db.insert(uploadRateBuckets).values({
      key: rateKey,
      attempts: 20,
      windowStart: new Date(),
    });

    const imageBytes = await createValidImageBytes(10, 10, "png");
    const req = makeUploadRequest(productId, token, csrf, "key-rate-21", imageBytes);
    const res = await postImage(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("replaying a completed upload does NOT consume rate limit quota even when quota is exhausted", async () => {
    const { token, csrf, userId } = await staff("catalog");
    const productId = await createProductFixture("Draft Prd QuotaReplay");
    const imageBytes = await createValidImageBytes(12, 12, "png");

    // Successful first upload
    const req1 = makeUploadRequest(productId, token, csrf, "key-replay-quota", imageBytes);
    const res1 = await postImage(req1, { params: Promise.resolve({ id: productId }) });
    expect(res1.status).toBe(201);

    // Now exhaust rate limit quota to 20
    const rateKey = createHash("sha256").update(JSON.stringify(["staff_upload", userId])).digest("hex");
    await db.update(uploadRateBuckets)
      .set({ attempts: 20 })
      .where(eq(uploadRateBuckets.key, rateKey));

    // Replay the completed upload
    const req2 = makeUploadRequest(productId, token, csrf, "key-replay-quota", imageBytes);
    const res2 = await postImage(req2, { params: Promise.resolve({ id: productId }) });
    expect(res2.status).toBe(201);
  });

  it("rejects corrupted image file or unsupported mime with 415", async () => {
    const { token, csrf } = await staff("catalog");
    const productId = await createProductFixture("Draft Prd Corrupt");
    const corruptedBytes = Buffer.from("this is plain text not an image");

    const req = makeUploadRequest(productId, token, csrf, "key-corrupt-1", corruptedBytes, "bad.png", "image/png");
    const res = await postImage(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(415);
  });

  it("compensates and cleans up staged private file upon database failure", async () => {
    const { token, csrf } = await staff("catalog");
    const productId = await createProductFixture("Draft Prd Compensation");
    const imageBytes = await createValidImageBytes(14, 14, "png");

    let savedFilename: string | null = null;
    vi.spyOn(storage, "savePrivate").mockImplementation(async (filename, buf) => {
      savedFilename = filename;
      await isolated.adapter.savePrivate(filename, buf);
    });

    // Mock writeAudit to throw inside Tx #2 after storage.savePrivate has staged the file
    vi.spyOn(auditModule, "writeAudit").mockRejectedValueOnce(new Error("Simulated audit write failure"));

    const req = makeUploadRequest(productId, token, csrf, "key-fail-1", imageBytes);
    const res = await postImage(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(500);

    // Staged private file should have been cleaned up via removePrivate
    expect(savedFilename).toBeTruthy();
    await expect(isolated.adapter.readPrivate(savedFilename!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records orphan to log if compensation cleanup throws error", async () => {
    const { token, csrf } = await staff("catalog");
    const productId = await createProductFixture("Draft Prd Orphan");
    const imageBytes = await createValidImageBytes(16, 16, "png");

    let orphanKeyRecorded: string | null = null;
    vi.spyOn(auditModule, "writeAudit").mockRejectedValueOnce(new Error("Simulated audit write failure"));
    vi.spyOn(storage, "removePrivate").mockRejectedValue(new Error("Disk permission denied"));
    vi.spyOn(storage, "recordOrphan").mockImplementation(async (filename) => {
      orphanKeyRecorded = filename;
    });

    const req = makeUploadRequest(productId, token, csrf, "key-orphan-1", imageBytes);
    const res = await postImage(req, { params: Promise.resolve({ id: productId }) });
    expect(res.status).toBe(500);

    // Verify orphan was recorded without exposing private paths
    expect(orphanKeyRecorded).toBeTruthy();
  });
});

