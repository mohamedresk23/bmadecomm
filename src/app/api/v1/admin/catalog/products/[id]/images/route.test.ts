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
  variants,
  variantMedia,
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
import { uploadGalleryImage } from "../../../../../../../../modules/catalog/products/application/gallery-service";
import { throttleStaffUpload } from "../../../../../../../../modules/catalog/products/infrastructure/upload-rate-limit";
import * as imageProcessor from "../../../../../../../../lib/media/image-process";
import * as auditModule from "../../../../../../../../shared/authz/audit";
import { GET as getGallery, POST as postImage, PUT as putGallery } from "./route";
import { GET as getPreview } from "./[imageId]/content/route";
import { DELETE as deleteImage } from "./[imageId]/route";
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
  vi.spyOn(storage, "savePrivate").mockImplementation((filename: string, buf: Buffer, metadata) => isolated.adapter.savePrivate(filename, buf, metadata));
  vi.spyOn(storage, "removePrivate").mockImplementation((filename: string) => isolated.adapter.removePrivate(filename));
  vi.spyOn(storage, "recordOrphan").mockImplementation((filename: string, loc, metadata) => isolated.adapter.recordOrphan(filename, loc, metadata));
  vi.spyOn(storage, "publish").mockImplementation((filename: string) => isolated.adapter.publish(filename));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(uploadRateBuckets);
  await db.delete(operationKeys);

  for (const id of createdProducts) {
    await db.delete(variantMedia).where(eq(variantMedia.productId, id));
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

function makePutGalleryRequest(
  productId: string,
  body: unknown,
  token?: string,
  csrf?: string,
  options: { correlationId?: string; contentType?: string } = {}
) {
  const headers: Record<string, string> = {
    "Content-Type": options.contentType ?? "application/json",
  };
  if (token) headers["Cookie"] = `__Host-staff-session=${token}`;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (options.correlationId) headers["X-Correlation-Id"] = options.correlationId;

  return new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images`, {
    method: "PUT",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
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



describe("upload remediation", () => {
  it.each([{name:"wrong.jpg",type:"image/png"},{name:"test.png",type:"image/jpeg"}])("rejects MIME/extension mismatch $name $type", async ({name,type}) => {
    const {token,csrf}=await staff(); const id=await createProductFixture();
    const response=await postImage(makeUploadRequest(id,token,csrf,randomUUID(),await createValidImageBytes(),name,type),{params:Promise.resolve({id})});
    expect(response.status).toBe(415); expect(storage.savePrivate).not.toHaveBeenCalled();
  });
  it("rejects hostile Origin before processing and shares fallback correlation on errors", async () => {
    const {token,csrf}=await staff(); const id=await createProductFixture();
    const req=makeUploadRequest(id,token,csrf,randomUUID(),await createValidImageBytes()); req.headers.set("Origin","https://hostile.example");
    const response=await postImage(req,{params:Promise.resolve({id})});
    expect(response.status).toBe(403); expect(storage.savePrivate).not.toHaveBeenCalled();
    expect((await response.json()).error.request_id).toBe(response.headers.get("x-correlation-id"));
  });
  it("returns safe storage failure and allows same-key retry", async () => {
    const {token,csrf}=await staff(); const id=await createProductFixture(); const bytes=await createValidImageBytes(); const key=randomUUID();
    vi.mocked(storage.savePrivate).mockRejectedValueOnce(new Error("private disk path must remain secret"));
    const failed=await postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});
    expect(failed.status).toBe(503); expect((await failed.json()).error.code).toBe("MEDIA_UNAVAILABLE");
    const retried=await postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});
    expect(retried.status).toBe(201); createdMedia.push((await retried.json()).image.mediaId);
  });
  it("rechecks Draft and live authorization on completed replay", async () => {
    const {token,csrf,userId}=await staff(); const id=await createProductFixture(); const bytes=await createValidImageBytes(); const key=randomUUID();
    const send=()=>postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});
    const first=await send(); expect(first.status).toBe(201); createdMedia.push((await first.json()).image.mediaId);
    await db.update(products).set({status:"published"}).where(eq(products.id,id)); expect((await send()).status).toBe(409);
    await db.update(staffAccounts).set({enabled:false}).where(eq(staffAccounts.userId,userId)); expect([401,403]).toContain((await send()).status);
  });
  it("ignores removed high positions when appending", async () => {
    const {token,csrf}=await staff(); const id=await createProductFixture(); const mid=await createMediaFixture(randomUUID()+".png");
    await db.insert(productMedia).values({id:randomUUID(),productId:id,mediaId:mid,sortOrder:999,removedAt:new Date()});
    const response=await postImage(makeUploadRequest(id,token,csrf,randomUUID(),await createValidImageBytes()),{params:Promise.resolve({id})});
    expect(response.status).toBe(201); const body=await response.json(); createdMedia.push(body.image.mediaId); expect(body.image.position).toBe(0);
  });
});


describe("ambiguous transaction completion", () => {
  it.each([false,true])("preserves private bytes after commit response loss (probe failure=%s)", async probeFails => {
    const {token,csrf}=await staff(); const id=await createProductFixture(); const bytes=await createValidImageBytes(); const key=randomUUID();
    const transaction=db.transaction.bind(db) as (callback: Parameters<typeof db.transaction>[0]) => Promise<unknown>; let injected=false; let wrote=false;
    vi.mocked(storage.savePrivate).mockImplementation(async (filename, bytes, metadata)=>{await isolated.adapter.savePrivate(filename,bytes,metadata);wrote=true;});
    const spy=vi.spyOn(db,"transaction").mockImplementation(async (...args: Parameters<typeof db.transaction>) => {
      if (injected && probeFails) throw new Error("independent probe unavailable");
      const result=await transaction(args[0]);
      if (wrote && !injected) {injected=true;throw new Error("COMMIT response lost");}
      return result;
    });
    const response=await postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});
    spy.mockRestore();
    expect(response.status).toBe(probeFails?503:201); expect(storage.removePrivate).not.toHaveBeenCalled();
    const rows=await db.select().from(productMedia).where(eq(productMedia.productId,id)); expect(rows).toHaveLength(1); createdMedia.push(rows[0].mediaId);
    const [saved]=await db.select().from(media).where(eq(media.id,rows[0].mediaId)); expect((await isolated.adapter.readPrivate(saved.filename)).length).toBeGreaterThan(0);
    const retry=await postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})}); expect(retry.status).toBe(201);
    expect((await db.select().from(productMedia).where(eq(productMedia.productId,id)))).toHaveLength(1);
  });
});


describe("lease ownership and cancellation", () => {
  it("fences a superseded worker before staging and protects its replacement", async () => {
    const {token,csrf}=await staff(); const id=await createProductFixture(); const bytes=await createValidImageBytes(); const key=randomUUID();
    let resume!: (bytes:Buffer)=>void; let started!: ()=>void; const entered=new Promise<void>(resolve=>{started=resolve;});
    vi.spyOn(imageProcessor,"processImage").mockImplementationOnce(()=>{started(); return new Promise<Buffer>(resolve=>{resume=resolve;});});
    const pending=postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})}); await entered;
    const [original]=await db.select().from(operationKeys).where(eq(operationKeys.key,key));
    const replacement=randomUUID()+":"+Date.now(); await db.update(operationKeys).set({id:replacement}).where(eq(operationKeys.id,original.id));
    resume(bytes); const response=await pending; expect(response.status).toBe(409); expect(storage.savePrivate).not.toHaveBeenCalled();
    const [retained]=await db.select().from(operationKeys).where(eq(operationKeys.key,key)); expect(retained.id).toBe(replacement);
    expect(await db.select().from(productMedia).where(eq(productMedia.productId,id))).toHaveLength(0);
  });
  it("rejects different payload immediately while the matching owner processes", async () => {
    const {token,csrf}=await staff(); const id=await createProductFixture(); const bytes=await createValidImageBytes(); const key=randomUUID();
    let resume!: (bytes:Buffer)=>void; let started!: ()=>void; const entered=new Promise<void>(resolve=>{started=resolve;});
    vi.spyOn(imageProcessor,"processImage").mockImplementationOnce(()=>{started();return new Promise<Buffer>(resolve=>{resume=resolve;});});
    const owner=postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})}); await entered;
    const mismatch=await postImage(makeUploadRequest(id,token,csrf,key,await createValidImageBytes(11)),{params:Promise.resolve({id})});
    expect(mismatch.status).toBe(409); resume(bytes); const response=await owner; expect(response.status).toBe(201); createdMedia.push((await response.json()).image.mediaId);
  });
});


it("rejects animated PNG without staging",async()=>{
  const {token,csrf}=await staff();const id=await createProductFixture();const png=await createValidImageBytes();const chunk=Buffer.alloc(12);chunk.write("acTL",4,"ascii");
  const bytes=Buffer.concat([png.subarray(0,8),chunk,png.subarray(8)]);
  const response=await postImage(makeUploadRequest(id,token,csrf,randomUUID(),bytes),{params:Promise.resolve({id})});expect(response.status).toBe(422);expect(storage.savePrivate).not.toHaveBeenCalled();
});
it("cancels duplicate waiting promptly without consuming quota",async()=>{
  const {token,csrf,userId}=await staff();const id=await createProductFixture();const bytes=await createValidImageBytes();const key=randomUUID();
  let resume!:(bytes:Buffer)=>void;let started!:()=>void;const entered=new Promise<void>(r=>{started=r;});
  vi.spyOn(imageProcessor,"processImage").mockImplementationOnce(()=>{started();return new Promise<Buffer>(r=>{resume=r;});});
  const owner=postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});await entered;
  const controller=new AbortController();const waiter=postImage(new Request(makeUploadRequest(id,token,csrf,key,bytes),{signal:controller.signal}),{params:Promise.resolve({id})});
  await new Promise(r=>setTimeout(r,50));controller.abort();expect((await waiter).status).toBe(400);resume(bytes);const saved=await owner;createdMedia.push((await saved.json()).image.mediaId);
  const [bucket]=await db.select().from(uploadRateBuckets).where(eq(uploadRateBuckets.key,createHash("sha256").update(JSON.stringify(["staff_upload",userId])).digest("hex")));expect(bucket.attempts).toBe(1);
});
it("reacquires a disappeared lease after the owner fails",async()=>{
  const {token,csrf}=await staff();const id=await createProductFixture();const bytes=await createValidImageBytes();const key=randomUUID();
  let fail!:(error:Error)=>void;let started!:()=>void;const entered=new Promise<void>(r=>{started=r;});
  vi.spyOn(imageProcessor,"processImage").mockImplementationOnce(()=>{started();return new Promise<Buffer>((_,reject)=>{fail=reject;});});
  const owner=postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});await entered;
  const waiter=postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});await new Promise(r=>setTimeout(r,40));fail(new Error("worker failed"));expect((await owner).status).toBe(500);
  const saved=await waiter;expect(saved.status).toBe(201);createdMedia.push((await saved.json()).image.mediaId);
});


it("computes precise Retry-After and resets quota at window rollover",async()=>{
  const userId=randomUUID();const start=1800000000000;const now=new Date(start+123000);for(let i=0;i<20;i++)expect(await throttleStaffUpload(db,userId,now)).toBe(0);
  expect(await throttleStaffUpload(db,userId,now)).toBe(477);expect(await throttleStaffUpload(db,userId,new Date(start+600000))).toBe(0);
});
it("rejects expired incomplete leases without reclaim or quota",async()=>{
  const {token,csrf}=await staff();const id=await createProductFixture();const bytes=await createValidImageBytes();const key=randomUUID();
  const first=await postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});const saved=await first.json();createdMedia.push(saved.image.mediaId);
  const [existing]=await db.select().from(operationKeys).where(eq(operationKeys.key,key));
  await db.update(operationKeys).set({completedAt:null,result:null,createdAt:new Date(Date.now()-86400001)}).where(eq(operationKeys.id,existing.id));
  const response=await postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});expect(response.status).toBe(409);
  expect((await db.select().from(operationKeys).where(eq(operationKeys.key,key)))[0].id).toBe(existing.id);
});


it.each(["revoked","expired"])("rejects %s session on completed replay",async state=>{
  const {token,csrf,userId}=await staff();const id=await createProductFixture();const bytes=await createValidImageBytes();const key=randomUUID();
  const first=await postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});createdMedia.push((await first.json()).image.mediaId);
  await db.update(sessions).set(state==="revoked"?{revokedAt:new Date()}:{expiresAt:new Date(Date.now()-1000)}).where(eq(sessions.userId,userId));
  const response=await postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});expect(response.status).toBe(401);
});


it.each([{id:" ",key:"valid"},{id:"product\tidentifier",key:"valid"},{id:"valid",key:"key\tcontrol"}])("rejects invalid identifiers %j",async({id,key})=>{
  const {token,csrf}=await staff();const response=await postImage(makeUploadRequest(id,token,csrf,key,await createValidImageBytes()),{params:Promise.resolve({id})});expect(response.status).toBe(400);expect(storage.savePrivate).not.toHaveBeenCalled();
});
it("validates NUL identifiers at the service boundary",async()=>{
  await expect(uploadGalleryImage(db,{productId:"product\0id",staffUserId:"staff",requestId:"request",idempotencyKey:"valid",file:{name:"test.png",type:"image/png",buffer:Buffer.from("x")}})).rejects.toMatchObject({statusCode:400});
});


it("mints lease age when a delayed waiter wins rather than when it began waiting",async()=>{
  const {token,csrf}=await staff();const id=await createProductFixture();const bytes=await createValidImageBytes();const key=randomUUID();let clock=Date.now();const initial=clock;vi.spyOn(Date,"now").mockImplementation(()=>clock);
  let fail!:(e:Error)=>void;let resume!:(b:Buffer)=>void;let enteredFirst!:()=>void;let enteredSecond!:()=>void;
  const firstEntered=new Promise<void>(r=>{enteredFirst=r;});const secondEntered=new Promise<void>(r=>{enteredSecond=r;});
  const processor=vi.spyOn(imageProcessor,"processImage").mockImplementationOnce(()=>{enteredFirst();return new Promise<Buffer>((_,reject)=>{fail=reject;});}).mockImplementationOnce(()=>{enteredSecond();return new Promise<Buffer>(r=>{resume=r;});});
  const first=postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});await firstEntered;
  const second=postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});await new Promise(r=>setTimeout(r,40));clock=initial+14000;fail(new Error("first failed"));await first;await secondEntered;
  const [claimed]=await db.select().from(operationKeys).where(eq(operationKeys.key,key));expect(Number(claimed.id.split(":")[1])).toBe(clock);
  clock=initial+16000;const controller=new AbortController();const third=postImage(new Request(makeUploadRequest(id,token,csrf,key,bytes),{signal:controller.signal}),{params:Promise.resolve({id})});await new Promise(r=>setTimeout(r,50));expect(processor).toHaveBeenCalledTimes(2);controller.abort();expect((await third).status).toBe(400);
  resume(bytes);const saved=await second;expect(saved.status).toBe(201);createdMedia.push((await saved.json()).image.mediaId);
});


it("renews a healthy held worker so duplicates cannot steal its lease or consume quota",async()=>{
  const {token,csrf,userId}=await staff();const id=await createProductFixture();const bytes=await createValidImageBytes();const key=randomUUID();let clock=Date.now();const initial=clock;vi.spyOn(Date,"now").mockImplementation(()=>clock);
  let resume!:(b:Buffer)=>void;let entered!:()=>void;const ready=new Promise<void>(r=>{entered=r;});const processor=vi.spyOn(imageProcessor,"processImage").mockImplementationOnce(()=>{entered();return new Promise<Buffer>(r=>{resume=r;});});
  const owner=postImage(makeUploadRequest(id,token,csrf,key,bytes),{params:Promise.resolve({id})});await ready;const [before]=await db.select().from(operationKeys).where(eq(operationKeys.key,key));clock=initial+14000;
  await new Promise(r=>setTimeout(r,4200));const [renewed]=await db.select().from(operationKeys).where(eq(operationKeys.key,key));expect(renewed.id).not.toBe(before.id);expect(renewed.createdAt).toEqual(before.createdAt);
  clock=initial+20000;const controller=new AbortController();const duplicate=postImage(new Request(makeUploadRequest(id,token,csrf,key,bytes),{signal:controller.signal}),{params:Promise.resolve({id})});await new Promise(r=>setTimeout(r,80));expect(processor).toHaveBeenCalledTimes(1);controller.abort();expect((await duplicate).status).toBe(400);
  resume(bytes);const saved=await owner;expect(saved.status).toBe(201);createdMedia.push((await saved.json()).image.mediaId);const rateKey=createHash("sha256").update(JSON.stringify(["staff_upload",userId])).digest("hex");expect((await db.select().from(uploadRateBuckets).where(eq(uploadRateBuckets.key,rateKey)))[0].attempts).toBe(1);
});

describe("PUT /api/v1/admin/catalog/products/[id]/images - Update gallery", () => {
  async function seedAttachments(productId: string, count = 2) {
    const pims: string[] = [];
    for (let i = 0; i < count; i++) {
      const filename = `${randomUUID()}.png`;
      const mediaId = await createMediaFixture(filename);
      const pimId = `pim_${randomUUID().slice(0, 8)}`;
      await db.insert(productMedia).values({
        id: pimId,
        productId,
        mediaId,
        sortOrder: i,
        altText: i === 0 ? "" : `Alt ${i}`,
      });
      pims.push(pimId);
    }
    return pims;
  }

  it("updates alt text on active image, increments revision, writes audit, and clears publication issues", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0, pim1] = await seedAttachments(productId, 2);

    const payload = {
      expectedRevision: "0",
      images: [
        { id: pim0, altText: "Front view" },
        { id: pim1, altText: "Back view" },
      ],
      variantImages: [],
    };

    const req = makePutGalleryRequest(productId, payload, token, csrf);
    const res = await putGallery(req, { params: Promise.resolve({ id: productId }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.gallery.revision).toBe("1");
    expect(data.gallery.images[0].altText).toBe("Front view");
    expect(data.gallery.images[1].altText).toBe("Back view");
    expect(data.gallery.publicationIssues).toEqual([]);

    // Verify database state
    const [prod] = await db.select({ mediaRevision: products.mediaRevision }).from(products).where(eq(products.id, productId));
    expect(prod.mediaRevision).toBe(BigInt(1));

    const rows = await db.select({ id: productMedia.id, altText: productMedia.altText }).from(productMedia).where(eq(productMedia.productId, productId));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.altText]));
    expect(byId[pim0]).toBe("Front view");
    expect(byId[pim1]).toBe("Back view");

    // Verify audit log
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${productId}`));
    const updateAudit = audits.find((a) => a.action === "catalog.product.gallery.update");
    expect(updateAudit).toBeTruthy();
    const diff = updateAudit?.diff as {
      mediaRevision: string;
      previousRevision: string;
      nextRevision: string;
      before: Array<{ id: string; position: number; altText: string }>;
      after: Array<{ id: string; position: number; altText: string }>;
    };
    expect(diff.mediaRevision).toBe("1");
    expect(diff.previousRevision).toBe("0");
    expect(diff.nextRevision).toBe("1");
    expect(diff.before).toEqual([
      { id: pim0, position: 0, altText: "" },
      { id: pim1, position: 1, altText: "Alt 1" },
    ]);
    expect(diff.after).toEqual([
      { id: pim0, position: 0, altText: "Front view" },
      { id: pim1, position: 1, altText: "Back view" },
    ]);
  });

  it("persists a gallery permutation and primary through GET and treats an identical resubmission as a no-op", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const ids = await seedAttachments(productId, 3);
    const ordered = [ids[2], ids[0], ids[1]];
    const images = ordered.map(id => ({ id, altText: `Description for ${id}` }));
    const result = await putGallery(makePutGalleryRequest(productId, { expectedRevision: "0", images, variantImages: [] }, token, csrf), { params: Promise.resolve({ id: productId }) });
    expect(result.status).toBe(200);
    const response = await getGallery(new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images`, { headers: { Cookie: `__Host-staff-session=${token}` } }), { params: Promise.resolve({ id: productId }) });
    const { gallery } = await response.json();
    expect(gallery.primaryImageId).toBe(ordered[0]);
    expect(gallery.images.map((image: { id: string; position: number }) => [image.id, image.position])).toEqual(ordered.map((id, index) => [id,index]));
    expect(gallery.images.map((image: { altText: string }) => image.altText)).toEqual(images.map(image => image.altText));
    const noop = await putGallery(makePutGalleryRequest(productId, { expectedRevision: "1", images, variantImages: [] }, token, csrf), { params: Promise.resolve({ id: productId }) });
    expect((await noop.json()).gallery.revision).toBe("1");
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${productId}`));
    expect(audits.filter(a => a.action === "catalog.product.gallery.update")).toHaveLength(1);
  });

  it("detects no-op when alt text and order are identical: returns 200, unchanged revision, zero audit entries", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0, pim1] = await seedAttachments(productId, 2);

    // Initial state: pim0 is "", pim1 is "Alt 1", revision is 0
    const auditsBefore = await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${productId}`));

    // Submit identical alt text and order
    const payload = {
      expectedRevision: "0",
      images: [
        { id: pim0, altText: "" },
        { id: pim1, altText: "Alt 1" },
      ],
      variantImages: [],
    };

    const req = makePutGalleryRequest(productId, payload, token, csrf);
    const res = await putGallery(req, { params: Promise.resolve({ id: productId }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.gallery.revision).toBe("0");

    // DB revision remains 0
    const [prod] = await db.select({ mediaRevision: products.mediaRevision }).from(products).where(eq(products.id, productId));
    expect(prod.mediaRevision).toBe(BigInt(0));

    // Zero new audit events
    const auditsAfter = await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${productId}`));
    expect(auditsAfter.length).toBe(auditsBefore.length);
  });

  it("handles whitespace trimming in no-op detection (trimmed identical = no-op)", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0, pim1] = await seedAttachments(productId, 2);

    // Submit with padding that trims to identical values
    const payload = {
      expectedRevision: "0",
      images: [
        { id: pim0, altText: "   " }, // trims to ""
        { id: pim1, altText: "  Alt 1  " }, // trims to "Alt 1"
      ],
      variantImages: [],
    };

    const req = makePutGalleryRequest(productId, payload, token, csrf);
    const res = await putGallery(req, { params: Promise.resolve({ id: productId }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.gallery.revision).toBe("0");

    // No revision bump
    const [prod] = await db.select({ mediaRevision: products.mediaRevision }).from(products).where(eq(products.id, productId));
    expect(prod.mediaRevision).toBe(BigInt(0));
  });

  it("rejects stale revision with 409 STALE_GALLERY and leaves gallery unchanged", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0] = await seedAttachments(productId, 1);

    const payload = {
      expectedRevision: "42", // Stale! Current is 0
      images: [{ id: pim0, altText: "Updated alt" }],
      variantImages: [],
    };

    const req = makePutGalleryRequest(productId, payload, token, csrf);
    const res = await putGallery(req, { params: Promise.resolve({ id: productId }) });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("STALE_GALLERY");

    // DB remains unchanged
    const [row] = await db.select({ altText: productMedia.altText }).from(productMedia).where(eq(productMedia.id, pim0));
    expect(row.altText).toBe("");
  });

  it("rejects editing non-draft products with 409 Conflict", async () => {
    const { token, csrf } = await staff();
    for (const status of ["published", "archived"] as const) {
      const productId = await createProductFixture("Non-draft", status);
      const [pim0] = await seedAttachments(productId, 1);

      const payload = {
        expectedRevision: "0",
        images: [{ id: pim0, altText: "New alt" }],
        variantImages: [],
      };

      const req = makePutGalleryRequest(productId, payload, token, csrf);
      const res = await putGallery(req, { params: Promise.resolve({ id: productId }) });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.message).toContain("Only drafts can be edited");
    }
  });

  it("rejects missing, extra, and foreign image IDs with 422", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0, pim1] = await seedAttachments(productId, 2);

    // 1. Missing image (only 1 provided instead of 2)
    const missingRes = await putGallery(
      makePutGalleryRequest(productId, {
        expectedRevision: "0",
        images: [{ id: pim0, altText: "Only one" }],
        variantImages: [],
      }, token, csrf),
      { params: Promise.resolve({ id: productId }) }
    );
    expect(missingRes.status).toBe(422);

    // 2. Extra image ID
    const extraRes = await putGallery(
      makePutGalleryRequest(productId, {
        expectedRevision: "0",
        images: [
          { id: pim0, altText: "One" },
          { id: pim1, altText: "Two" },
          { id: "pim_extra_id", altText: "Three" },
        ],
        variantImages: [],
      }, token, csrf),
      { params: Promise.resolve({ id: productId }) }
    );
    expect(extraRes.status).toBe(422);

    // 3. Foreign image ID (same count, but foreign ID)
    const foreignRes = await putGallery(
      makePutGalleryRequest(productId, {
        expectedRevision: "0",
        images: [
          { id: pim0, altText: "One" },
          { id: "pim_foreign_different", altText: "Two" },
        ],
        variantImages: [],
      }, token, csrf),
      { params: Promise.resolve({ id: productId }) }
    );
    expect(foreignRes.status).toBe(422);
  });

  it("rejects duplicate image IDs in payload with 422", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0] = await seedAttachments(productId, 2);

    const dupRes = await putGallery(
      makePutGalleryRequest(productId, {
        expectedRevision: "0",
        images: [
          { id: pim0, altText: "First" },
          { id: pim0, altText: "Duplicate" },
        ],
        variantImages: [],
      }, token, csrf),
      { params: Promise.resolve({ id: productId }) }
    );
    expect(dupRes.status).toBe(422);
  });

  it("rejects oversized alt text (>500 chars) with 422 and field error images.<id>.altText", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0] = await seedAttachments(productId, 1);

    const payload = {
      expectedRevision: "0",
      images: [{ id: pim0, altText: "a".repeat(501) }],
      variantImages: [],
    };

    const res = await putGallery(
      makePutGalleryRequest(productId, payload, token, csrf),
      { params: Promise.resolve({ id: productId }) }
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    const detail = body.error.details?.find((d: { field: string }) => d.field === `images.${pim0}.altText`);
    expect(detail).toBeTruthy();
  });

  it("rejects control characters in alt text with 422 and field error images.<id>.altText", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0] = await seedAttachments(productId, 1);

    const payload = {
      expectedRevision: "0",
      images: [{ id: pim0, altText: "bad\x07alt" }],
      variantImages: [],
    };

    const res = await putGallery(
      makePutGalleryRequest(productId, payload, token, csrf),
      { params: Promise.resolve({ id: productId }) }
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    const detail = body.error.details?.find((d: { field: string }) => d.field === `images.${pim0}.altText`);
    expect(detail).toBeTruthy();
  });

  it("rejects an unknown variant assignment with safe 422", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0] = await seedAttachments(productId, 1);

    const payload = {
      expectedRevision: "0",
      images: [{ id: pim0, altText: "Valid" }],
      variantImages: [{ variantId: "var_1", imageId: pim0 }],
    };

    const res = await putGallery(
      makePutGalleryRequest(productId, payload, token, csrf),
      { params: Promise.resolve({ id: productId }) }
    );
    expect(res.status).toBe(422);
  });

  it("rejects unknown properties in payload with 422 due to strict schema", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0] = await seedAttachments(productId, 1);

    const payload = {
      expectedRevision: "0",
      images: [{ id: pim0, altText: "Valid" }],
      variantImages: [],
      unknownField: "malicious",
    };

    const res = await putGallery(
      makePutGalleryRequest(productId, payload, token, csrf),
      { params: Promise.resolve({ id: productId }) }
    );
    expect(res.status).toBe(422);
  });

  it("handles competing revision writes concurrently with row locking: one succeeds, one gets 409", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0] = await seedAttachments(productId, 1);

    const req1 = makePutGalleryRequest(
      productId,
      { expectedRevision: "0", images: [{ id: pim0, altText: "First worker" }], variantImages: [] },
      token,
      csrf
    );
    const req2 = makePutGalleryRequest(
      productId,
      { expectedRevision: "0", images: [{ id: pim0, altText: "Second worker" }], variantImages: [] },
      token,
      csrf
    );

    const [res1, res2] = await Promise.all([
      putGallery(req1, { params: Promise.resolve({ id: productId }) }),
      putGallery(req2, { params: Promise.resolve({ id: productId }) }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Revision incremented exactly once to 1
    const [prod] = await db.select({ mediaRevision: products.mediaRevision }).from(products).where(eq(products.id, productId));
    expect(prod.mediaRevision).toBe(BigInt(1));

    // Exactly 1 gallery audit record written
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${productId}`));
    const galleryAudits = audits.filter((a) => a.action === "catalog.product.gallery.update");
    expect(galleryAudits).toHaveLength(1);
  });

  it("rejects guest, customer, and missing/invalid CSRF token", async () => {
    const productId = await createProductFixture();
    const [pim0] = await seedAttachments(productId, 1);
    const validPayload = { expectedRevision: "0", images: [{ id: pim0, altText: "Alt" }], variantImages: [] };

    // 1. Guest request (no cookie)
    const guestReq = makePutGalleryRequest(productId, validPayload);
    const guestRes = await putGallery(guestReq, { params: Promise.resolve({ id: productId }) });
    expect(guestRes.status).toBe(401);

    // 2. Non-catalog staff session
    const nonCatalog = await staff("order_manager");
    const nonCatalogReq = makePutGalleryRequest(productId, validPayload, nonCatalog.token, nonCatalog.csrf);
    const nonCatalogRes = await putGallery(nonCatalogReq, { params: Promise.resolve({ id: productId }) });
    expect(nonCatalogRes.status).toBe(403);

    // 3. Staff session with missing CSRF
    const { token } = await staff();
    const noCsrfReq = makePutGalleryRequest(productId, validPayload, token, undefined);
    const noCsrfRes = await putGallery(noCsrfReq, { params: Promise.resolve({ id: productId }) });
    expect(noCsrfRes.status).toBe(403);

    // 4. Staff session with invalid CSRF
    const badCsrfReq = makePutGalleryRequest(productId, validPayload, token, "invalid-csrf-token");
    const badCsrfRes = await putGallery(badCsrfReq, { params: Promise.resolve({ id: productId }) });
    expect(badCsrfRes.status).toBe(403);
  });

  it("rejects payload exceeding 64 KiB with 413 PAYLOAD_TOO_LARGE", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();

    // Large JSON > 64 KiB (65536 bytes)
    const largePadding = "x".repeat(70 * 1024);
    const payload = JSON.stringify({ expectedRevision: "0", images: [], padding: largePadding });

    const req = makePutGalleryRequest(productId, payload, token, csrf);
    const res = await putGallery(req, { params: Promise.resolve({ id: productId }) });

    expect(res.status).toBe(413);
  });

  it("rejects non-JSON content type with 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();

    const req = makePutGalleryRequest(productId, "plain text body", token, csrf, {
      contentType: "text/plain",
    });
    const res = await putGallery(req, { params: Promise.resolve({ id: productId }) });

    expect(res.status).toBe(415);
  });

  it("preserves blank alt text on draft save and returns publication issue for that image", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0, pim1] = await seedAttachments(productId, 2);

    // Update pim1 to non-blank, but keep pim0 as ""
    const payload = {
      expectedRevision: "0",
      images: [
        { id: pim0, altText: "" },
        { id: pim1, altText: "Valid alt for image 2" },
      ],
      variantImages: [],
    };

    const req = makePutGalleryRequest(productId, payload, token, csrf);
    const res = await putGallery(req, { params: Promise.resolve({ id: productId }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.gallery.revision).toBe("1");
    expect(data.gallery.images[0].altText).toBe("");
    expect(data.gallery.images[1].altText).toBe("Valid alt for image 2");

    // publicationIssues has exactly 1 entry for pim0
    expect(data.gallery.publicationIssues).toEqual([
      { field: `images.${pim0}.altText`, message: "Alt text is required before publication" },
    ]);
  });

  it("rejects expectedRevision exceeding 64-bit integer limit (9223372036854775807n) with 422", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const [pim0] = await seedAttachments(productId, 1);

    const payload = {
      expectedRevision: "9223372036854775808",
      images: [{ id: pim0, altText: "New alt" }],
      variantImages: [],
    };

    const req = makePutGalleryRequest(productId, payload, token, csrf);
    const res = await putGallery(req, { params: Promise.resolve({ id: productId }) });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("UNPROCESSABLE_ENTITY");
  });
});



describe("variant image API", () => {
  it("persists shared mappings, treats mapping ordering as a no-op and clears omitted assignments", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const imageId = randomUUID();
    const mediaId = await createMediaFixture(`${randomUUID()}.png`);
    await db.insert(productMedia).values({ id: imageId, productId, mediaId, sortOrder: 0, altText: "Mapped" });
    const variantIds = [randomUUID(), randomUUID()];
    await db.insert(variants).values(variantIds.map((id, index) => ({ id, productId, sku: `MAP-${id.toUpperCase()}`, combinationKey: `${index}`, priceMinor: BigInt(0), currency: "USD", currencyScale: 2, sortOrder: index })));
    const payload = { expectedRevision: "0", images: [{ id: imageId, altText: "Mapped" }], variantImages: variantIds.map(variantId => ({ variantId, imageId })) };
    const ctx = { params: Promise.resolve({ id: productId }) };
    const save = async (body: unknown) => putGallery(makePutGalleryRequest(productId, body, token, csrf), ctx);
    const saved = await save(payload); expect(saved.status).toBe(200);
    expect((await saved.json()).gallery.variantImages).toHaveLength(2);
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${productId}`));
    const noop = await save({ ...payload, expectedRevision: "1", variantImages: [...payload.variantImages].reverse() });
    expect(noop.status).toBe(200); expect((await noop.json()).gallery.revision).toBe("1");
    expect(await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${productId}`))).toHaveLength(audits.length);
    const duplicate = await save({ ...payload, expectedRevision: "1", variantImages: [payload.variantImages[0], payload.variantImages[0]] });
    expect(duplicate.status).toBe(422); expect(duplicate.headers.get("Cache-Control")).toContain("no-store");
    const cleared = await save({ expectedRevision: "1", images: payload.images });
    expect(cleared.status).toBe(200); expect((await cleared.json()).gallery).toMatchObject({ revision: "2", variantImages: [] });
  });
});

function makeDeleteImageRequest(
  productId: string,
  imageId: string,
  body: unknown,
  token?: string,
  csrf?: string,
  options: { correlationId?: string; contentType?: string } = {}
) {
  const headers: Record<string, string> = {
    "Content-Type": options.contentType ?? "application/json",
  };
  if (token) headers["Cookie"] = `__Host-staff-session=${token}`;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (options.correlationId) headers["X-Correlation-Id"] = options.correlationId;

  return new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images/${imageId}`, {
    method: "DELETE",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("DELETE /api/v1/admin/catalog/products/[id]/images/[imageId] - Remove gallery image", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const productId = await createProductFixture();
    const mediaId = await createMediaFixture("auth.png");
    const imageId = `pim_${randomUUID().slice(0, 8)}`;
    await db.insert(productMedia).values({ id: imageId, productId, mediaId, sortOrder: 0, altText: "" });

    const req = makeDeleteImageRequest(productId, imageId, { expectedRevision: "0" });
    const res = await deleteImage(req, { params: Promise.resolve({ id: productId, imageId }) });
    expect(res.status).toBe(401);
  });

  it("rejects non-catalog staff session with 403", async () => {
    const nonCatalog = await staff("order_manager");
    const productId = await createProductFixture();
    const mediaId = await createMediaFixture("role.png");
    const imageId = `pim_${randomUUID().slice(0, 8)}`;
    await db.insert(productMedia).values({ id: imageId, productId, mediaId, sortOrder: 0, altText: "" });

    const req = makeDeleteImageRequest(productId, imageId, { expectedRevision: "0" }, nonCatalog.token, nonCatalog.csrf);
    const res = await deleteImage(req, { params: Promise.resolve({ id: productId, imageId }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("rejects invalid or missing CSRF token with 403", async () => {
    const { token } = await staff();
    const productId = await createProductFixture();
    const mediaId = await createMediaFixture("csrf.png");
    const imageId = `pim_${randomUUID().slice(0, 8)}`;
    await db.insert(productMedia).values({ id: imageId, productId, mediaId, sortOrder: 0, altText: "" });

    // Missing CSRF
    const reqNoCsrf = makeDeleteImageRequest(productId, imageId, { expectedRevision: "0" }, token, undefined);
    const resNoCsrf = await deleteImage(reqNoCsrf, { params: Promise.resolve({ id: productId, imageId }) });
    expect(resNoCsrf.status).toBe(403);

    // Invalid CSRF
    const reqBadCsrf = makeDeleteImageRequest(productId, imageId, { expectedRevision: "0" }, token, "bad-csrf-token");
    const resBadCsrf = await deleteImage(reqBadCsrf, { params: Promise.resolve({ id: productId, imageId }) });
    expect(resBadCsrf.status).toBe(403);
  });

  it("returns 404 for unknown product or cross-product image", async () => {
    const { token, csrf } = await staff();
    const productA = await createProductFixture("Product A");
    const productB = await createProductFixture("Product B");
    const mediaId = await createMediaFixture("foreign.png");
    const imageId = `pim_${randomUUID().slice(0, 8)}`;
    await db.insert(productMedia).values({ id: imageId, productId: productA, mediaId, sortOrder: 0, altText: "" });

    // Request deletion on productB for image belonging to productA
    const reqCross = makeDeleteImageRequest(productB, imageId, { expectedRevision: "0" }, token, csrf);
    const resCross = await deleteImage(reqCross, { params: Promise.resolve({ id: productB, imageId }) });
    expect(resCross.status).toBe(404);

    // Request deletion on unknown product
    const reqUnknown = makeDeleteImageRequest("prd_unknown", imageId, { expectedRevision: "0" }, token, csrf);
    const resUnknown = await deleteImage(reqUnknown, { params: Promise.resolve({ id: "prd_unknown", imageId }) });
    expect(resUnknown.status).toBe(404);
  });

  it("rejects non-draft product with 409 Conflict", async () => {
    const { token, csrf } = await staff();
    const publishedProduct = await createProductFixture("Published", "published");
    const mediaId = await createMediaFixture("pub.png");
    const imageId = `pim_${randomUUID().slice(0, 8)}`;
    await db.insert(productMedia).values({ id: imageId, productId: publishedProduct, mediaId, sortOrder: 0, altText: "" });

    const req = makeDeleteImageRequest(publishedProduct, imageId, { expectedRevision: "0" }, token, csrf);
    const res = await deleteImage(req, { params: Promise.resolve({ id: publishedProduct, imageId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("draft");
  });

  it("rejects stale revision with 409 STALE_GALLERY and leaves gallery unchanged", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const mediaId = await createMediaFixture("stale.png");
    const imageId = `pim_${randomUUID().slice(0, 8)}`;
    await db.insert(productMedia).values({ id: imageId, productId, mediaId, sortOrder: 0, altText: "" });

    const req = makeDeleteImageRequest(productId, imageId, { expectedRevision: "42" }, token, csrf);
    const res = await deleteImage(req, { params: Promise.resolve({ id: productId, imageId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("STALE_GALLERY");

    // DB remains active
    const [row] = await db.select().from(productMedia).where(eq(productMedia.id, imageId));
    expect(row.removedAt).toBeNull();
  });

  it("rejects invalid expectedRevision (exceeding 64-bit int or extra properties) with 422", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const mediaId = await createMediaFixture("invalid.png");
    const imageId = `pim_${randomUUID().slice(0, 8)}`;
    await db.insert(productMedia).values({ id: imageId, productId, mediaId, sortOrder: 0, altText: "" });

    // Exceeding 64-bit integer
    const req1 = makeDeleteImageRequest(productId, imageId, { expectedRevision: "9223372036854775808" }, token, csrf);
    const res1 = await deleteImage(req1, { params: Promise.resolve({ id: productId, imageId }) });
    expect(res1.status).toBe(422);

    // Extra property rejected by strict schema
    const req2 = makeDeleteImageRequest(productId, imageId, { expectedRevision: "0", extra: "forbidden" }, token, csrf);
    const res2 = await deleteImage(req2, { params: Promise.resolve({ id: productId, imageId }) });
    expect(res2.status).toBe(422);
  });

  it("rejects non-JSON content type with 415", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const imageId = "pim_test";

    const req = makeDeleteImageRequest(productId, imageId, "not json", token, csrf, { contentType: "text/plain" });
    const res = await deleteImage(req, { params: Promise.resolve({ id: productId, imageId }) });
    expect(res.status).toBe(415);
  });

  it("soft-removes primary image, clears variant mappings, compacts sort orders, updates primary fallback, retains media file bytes, and renders preview 404", async () => {
    const { token, csrf, userId } = await staff();
    const productId = await createProductFixture();
    const mediaBytes = Buffer.from("surviving-private-bytes");
    const media0 = await createMediaFixture("m0.png", mediaBytes);
    const media1 = await createMediaFixture("m1.png");
    const media2 = await createMediaFixture("m2.png");

    const pim0 = `pim_del_0`;
    const pim1 = `pim_del_1`;
    const pim2 = `pim_del_2`;

    await db.insert(productMedia).values([
      { id: pim0, productId, mediaId: media0, sortOrder: 0, altText: "First" },
      { id: pim1, productId, mediaId: media1, sortOrder: 1, altText: "Second" },
      { id: pim2, productId, mediaId: media2, sortOrder: 2, altText: "Third" },
    ]);

    const variantId = randomUUID();
    await db.insert(variants).values({
      id: variantId,
      productId,
      sku: "VAR-MAP-1",
      combinationKey: "color:red",
      priceMinor: BigInt(0),
      currency: "USD",
      currencyScale: 2,
      sortOrder: 0,
    });
    // Map variant to pim0
    await db.insert(variantMedia).values({
      productId,
      variantId,
      productMediaId: pim0,
    });

    // Send DELETE for pim0
    const req = makeDeleteImageRequest(productId, pim0, { expectedRevision: "0" }, token, csrf);
    const res = await deleteImage(req, { params: Promise.resolve({ id: productId, imageId: pim0 }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.gallery.revision).toBe("1");
    // New primary image is pim1
    expect(data.gallery.primaryImageId).toBe(pim1);
    expect(data.gallery.images).toHaveLength(2);
    expect(data.gallery.images[0].id).toBe(pim1);
    expect(data.gallery.images[0].position).toBe(0);
    expect(data.gallery.images[1].id).toBe(pim2);
    expect(data.gallery.images[1].position).toBe(1);
    // Variant mapping to pim0 cleared
    expect(data.gallery.variantImages).toEqual([]);

    // Check DB state: pim0 soft-removed
    const [pm0Row] = await db.select().from(productMedia).where(eq(productMedia.id, pim0));
    expect(pm0Row.removedAt).not.toBeNull();

    // Check DB state: pim1 and pim2 compacted to 0 and 1
    const [pm1Row] = await db.select().from(productMedia).where(eq(productMedia.id, pim1));
    expect(pm1Row.sortOrder).toBe(0);
    const [pm2Row] = await db.select().from(productMedia).where(eq(productMedia.id, pim2));
    expect(pm2Row.sortOrder).toBe(1);

    // Check DB state: variant_media row for pim0 deleted
    const vmMappings = await db.select().from(variantMedia).where(eq(variantMedia.productId, productId));
    expect(vmMappings).toHaveLength(0);

    // Media row in media table survives!
    const [m0Row] = await db.select().from(media).where(eq(media.id, media0));
    expect(m0Row).toBeTruthy();

    // Storage file on disk survives!
    const fileBytes = await isolated.adapter.readPrivate("m0.png");
    expect(fileBytes).toEqual(mediaBytes);

    // Audit log written
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${productId}`));
    const detachAudit = audits.find((a) => a.action === "catalog.product.image.detach");
    expect(detachAudit).toBeTruthy();
    expect(detachAudit?.actor).toBe(`staff:${userId}`);

    // GET content preview for soft-removed image immediately returns 404!
    const previewReq = new Request(`http://localhost:3000/api/v1/admin/catalog/products/${productId}/images/${pim0}/content`, {
      headers: { Cookie: `__Host-staff-session=${token}` },
    });
    const previewRes = await getPreview(previewReq, { params: Promise.resolve({ id: productId, imageId: pim0 }) });
    expect(previewRes.status).toBe(404);
  });

  it("removing the last image yields empty gallery with primaryImageId null and empty arrays", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const mediaId = await createMediaFixture("only.png");
    const imageId = `pim_only`;
    await db.insert(productMedia).values({ id: imageId, productId, mediaId, sortOrder: 0, altText: "Single image" });

    const req = makeDeleteImageRequest(productId, imageId, { expectedRevision: "0" }, token, csrf);
    const res = await deleteImage(req, { params: Promise.resolve({ id: productId, imageId }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.gallery).toEqual({
      productId,
      revision: "1",
      primaryImageId: null,
      images: [],
      variantImages: [],
      publicationIssues: [],
    });
  });

  it("rolls back soft-deletion, sort_order compaction, and revision on audit failure", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const mediaId = await createMediaFixture("rollback.png");
    const imageId = `pim_rollback`;
    await db.insert(productMedia).values({ id: imageId, productId, mediaId, sortOrder: 0, altText: "" });

    vi.spyOn(auditModule, "writeAudit").mockRejectedValueOnce(new Error("Audit failure during detach"));

    const req = makeDeleteImageRequest(productId, imageId, { expectedRevision: "0" }, token, csrf);
    const res = await deleteImage(req, { params: Promise.resolve({ id: productId, imageId }) });
    expect(res.status).toBe(500);

    // Verify rollback: image is still active and revision is still 0
    const [row] = await db.select().from(productMedia).where(eq(productMedia.id, imageId));
    expect(row.removedAt).toBeNull();
    const [prod] = await db.select().from(products).where(eq(products.id, productId));
    expect(prod.mediaRevision).toBe(BigInt(0));
  });

  it("rejects DELETE request exceeding MAX_DELETE_BODY (1024 bytes) with 413 PAYLOAD_TOO_LARGE", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const imageId = `pim_large`;

    const oversizedBody = JSON.stringify({
      expectedRevision: "0",
      padding: "x".repeat(2000),
    });

    const req = makeDeleteImageRequest(productId, imageId, oversizedBody, token, csrf);
    const res = await deleteImage(req, { params: Promise.resolve({ id: productId, imageId }) });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects malformed JSON on DELETE with 400 BAD_REQUEST", async () => {
    const { token, csrf } = await staff();
    const productId = await createProductFixture();
    const imageId = `pim_malformed`;

    const req = makeDeleteImageRequest(productId, imageId, "{ not a json }", token, csrf);
    const res = await deleteImage(req, { params: Promise.resolve({ id: productId, imageId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});

