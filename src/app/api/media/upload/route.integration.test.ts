import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { db } from "../../../../db";
import { media, roles, sessions, staffAccounts, userRoles, users } from "../../../../db/schema";
import { setupTestDb } from "../../../../test-utils/db";
import { issueStaffSession } from "../../../../modules/identity/infrastructure/staff-sessions";
import { STAFF_SESSION_POLICY, staffConfig } from "../../../../modules/identity/infrastructure/staff-config";
import { encryptStaffSecret, newStaffSeed, sessionCsrf } from "../../../../modules/identity/infrastructure/staff-crypto";
import { POST } from "./route";

const isolated = vi.hoisted(() => ({ root: "", files: [] as string[] }));
vi.mock("../../../../lib/media/storage", () => ({ storage: {
  async savePrivate(filename: string, bytes: Buffer) {
    isolated.files.push(filename);
    await fs.mkdir(path.join(isolated.root, "private"), { recursive: true });
    await fs.writeFile(path.join(isolated.root, "private", filename), bytes);
  },
  publish: vi.fn(() => { throw new Error("Pending media must not publish"); }),
} }));
const createdUsers: string[] = [];
beforeAll(setupTestDb);
beforeEach(async () => {
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("STAFF_MFA_KEY", randomBytes(32).toString("base64"));
  isolated.root = await fs.mkdtemp(path.join(os.tmpdir(), "logo-route-"));
});
afterEach(async () => {
  for (const filename of isolated.files) {
    await db.delete(media).where(eq(media.filename, filename));
    await fs.unlink(path.join(isolated.root, "private", filename));
  }
  isolated.files.length = 0;
  await fs.rmdir(path.join(isolated.root, "private")).catch(error => { if (error.code !== "ENOENT") throw error; });
  await fs.rmdir(isolated.root);
  for (const id of createdUsers) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(userRoles).where(eq(userRoles.userId, id));
    await db.delete(staffAccounts).where(eq(staffAccounts.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  createdUsers.length = 0;
  vi.unstubAllEnvs();
});
async function owner(role = "owner") {
  const userId = randomUUID();
  createdUsers.push(userId);
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, role: "staff", name: "Upload fixture", phone: "01000000000", passwordHash: "fixture" });
  await db.insert(staffAccounts).values({ userId, mfaEnrolledAt: new Date(), mfaSeed: encryptStaffSecret(newStaffSeed(), staffConfig().key, userId, "mfa") });
  await db.insert(roles).values({ key: role }).onConflictDoNothing();
  await db.insert(userRoles).values({ userId, roleKey: role });
  const issued = await issueStaffSession(db, userId, STAFF_SESSION_POLICY);
  if (!issued) throw new Error("Fixture session issuance failed");
  return { ...issued, userId };
}
async function upload(file: File) {
  const { token } = await owner();
  const body = new FormData();
  body.append("file", file);
  const encoded = new Request(`${staffConfig().origin}/api/media/upload`, { method: "POST", body });
  const bytes = await encoded.arrayBuffer();
  return POST(new Request(`${staffConfig().origin}/api/media/upload`, {
    method: "POST", body: bytes, headers: { "Content-Type": encoded.headers.get("Content-Type")!, Origin: staffConfig().origin,
      Cookie: `__Host-staff-session=${token}`, "X-CSRF-Token": sessionCsrf(token, staffConfig().key) },
  }));
}
describe("Real logo processor route integration", () => {
  it("persists a pending image and private bytes without a public file", async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: "red" } }).png().toBuffer();
    const response = await upload(new File([new Uint8Array(png)], "logo.png", { type: "image/png" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const result = await response.json();
    expect(result.status).toBe("pending");
    const [record] = await db.select().from(media).where(eq(media.id, result.id));
    expect(record.status).toBe("pending");
    expect(record.mimeType).toBe("image/png");
    const bytes = await fs.readFile(path.join(isolated.root, "private", record.filename));
    expect(bytes.length).toBe(record.size);
    expect((await sharp(bytes).metadata()).format).toBe("png");
    await expect(fs.stat(path.join(isolated.root, "public", record.filename))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(process.cwd(), "public", "uploads", record.filename))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([413, 415])("rejects invalid input with %s without saving bytes", async (status) => {
    const file = status === 413 ? new File([new Uint8Array(6 * 1024 * 1024)], "large.png") : new File(["%PDF-1.4"], "spoofed.png", { type: "image/png" });
    const response = await upload(file);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(isolated.files).toEqual([]);
  });
});
