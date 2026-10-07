import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import { auditEvents, media, storeSettings } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import {
  getStoreSettings,
  updateStoreSettings,
  getPublicStoreSettings,
} from "./store-settings";

beforeAll(setupTestDb);

describe("Store Settings Application Service", () => {
  it("retrieves default store settings with currency unlocked when no orders exist", async () => {
    await withIsolatedTx(async (tx) => {
      const result = await getStoreSettings(tx);

      expect(result.profile.store_name).toBe("متجر بيميد");
      expect(result.profile.currency).toBe("EGP");
      expect(result.profile.currency_symbol).toBe("ج.م");
      expect(result.currency_locked).toBe(false);
      expect(result.currency_locked_reason).toBeNull();
    });
  });

  it("updates store settings and writes an audit event with before/after diff (AC-E03-01-01)", async () => {
    await withIsolatedTx(async (tx) => {
      const actorId = "user_owner_test";
      const requestId = "req_test_123";

      const updated = await updateStoreSettings(
        tx,
        {
          store_name: "متجر بيميد التجريبي",
          legal_name: "شركة بيميد العالمية",
          support_email: "help@bmadecomm.eg",
          support_phone: "+201098765432",
          address: "شارع التحرير، الدقي",
          default_language: "ar-EG",
          currency: "EGP",
          timezone: "Africa/Cairo",
          date_format: "YYYY-MM-DD",
          order_prefix: "BM-",
        },
        actorId,
        requestId
      );

      expect(updated.store_name).toBe("متجر بيميد التجريبي");
      expect(updated.support_phone).toBe("+201098765432");
      expect(updated.order_prefix).toBe("BM-");
      expect(updated.updated_by).toBe(actorId);

      // Verify DB persistence
      const [persisted] = await tx
        .select()
        .from(storeSettings)
        .where(eq(storeSettings.id, "default"));
      expect(persisted.storeName).toBe("متجر بيميد التجريبي");
      expect(persisted.orderPrefix).toBe("BM-");

      // Verify audit log
      const audits = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "store_settings.updated"));
      expect(audits.length).toBeGreaterThan(0);
      const latestAudit = audits[audits.length - 1];
      expect(latestAudit.actor).toBe(actorId);
      expect(latestAudit.resource).toBe("store_settings:default");
      expect(latestAudit.requestId).toBe(requestId);
      expect(
        ((latestAudit.diff as Record<string, Record<string, unknown>>)?.after)
          ?.store_name
      ).toBe("متجر بيميد التجريبي");
    });
  });

  it("allows updating currency when zero orders exist (AC-E03-01-03)", async () => {
    await withIsolatedTx(async (tx) => {
      const updated = await updateStoreSettings(
        tx,
        {
          store_name: "متجر بيميد",
          support_email: "support@bmadecomm.eg",
          support_phone: "01012345678",
          default_language: "ar-EG",
          currency: "USD",
          timezone: "Africa/Cairo",
          date_format: "YYYY-MM-DD",
          order_prefix: "ORD-",
        },
        "owner_user"
      );

      expect(updated.currency).toBe("USD");
      expect(updated.currency_symbol).toBe("$");

      const [persisted] = await tx
        .select()
        .from(storeSettings)
        .where(eq(storeSettings.id, "default"));
      expect(persisted.currency).toBe("USD");
      expect(persisted.currencySymbol).toBe("$");
    });
  });

  it("rejects currency change with 409 Conflict when at least one order exists (AC-E03-01-02)", async () => {
    await withIsolatedTx(async (tx) => {
      // Create temporary orders table and seed 1 order to simulate trading store
      await tx.execute(
        sql`CREATE TEMP TABLE orders (id text primary key, total_minor integer);`
      );
      await tx.execute(
        sql`INSERT INTO orders (id, total_minor) VALUES ('ord-001', 5000);`
      );

      // Verify settings read now marks currency as locked
      const readSettings = await getStoreSettings(tx);
      expect(readSettings.currency_locked).toBe(true);
      expect(readSettings.currency_locked_reason).toContain("Orders exist");

      // Attempting to change currency must fail with 409 Conflict
      let error: ApiError | null = null;
      try {
        await updateStoreSettings(
          tx,
          {
            store_name: "متجر بيميد",
            support_email: "support@bmadecomm.eg",
            support_phone: "01012345678",
            default_language: "ar-EG",
            currency: "EUR", // Changed currency
            timezone: "Africa/Cairo",
            date_format: "YYYY-MM-DD",
            order_prefix: "ORD-",
          },
          "owner_user"
        );
      } catch (err) {
        error = err as ApiError;
      }

      expect(error).not.toBeNull();
      expect(error).toBeInstanceOf(ApiError);
      expect(error?.statusCode).toBe(409);
      expect(error?.code).toBe("CURRENCY_LOCKED_ORDERS_EXIST");
      expect(error?.details?.[0]?.field).toBe("currency");

      // Ensure currency remained unchanged
      const [persisted] = await tx
        .select()
        .from(storeSettings)
        .where(eq(storeSettings.id, "default"));
      expect(persisted.currency).toBe("EGP");

      // But updating non-currency fields while orders exist succeeds
      const nonCurrencyUpdate = await updateStoreSettings(
        tx,
        {
          store_name: "متجر بيميد المتطور",
          support_email: "support@bmadecomm.eg",
          support_phone: "01012345678",
          default_language: "ar-EG",
          currency: "EGP", // Preserved currency
          timezone: "Africa/Cairo",
          date_format: "YYYY-MM-DD",
          order_prefix: "ORD-",
        },
        "owner_user"
      );
      expect(nonCurrencyUpdate.store_name).toBe("متجر بيميد المتطور");
      expect(nonCurrencyUpdate.currency).toBe("EGP");
    });
  });

  it("handles logo_media_id validation and activates pending media (AC-E03-01-04)", async () => {
    await withIsolatedTx(async (tx) => {
      // 1. Throws 404 if media does not exist
      await expect(
        updateStoreSettings(
          tx,
          {
            store_name: "متجر بيميد",
            support_email: "support@bmadecomm.eg",
            support_phone: "01012345678",
            default_language: "ar-EG",
            currency: "EGP",
            timezone: "Africa/Cairo",
            date_format: "YYYY-MM-DD",
            order_prefix: "ORD-",
            logo_media_id: "non_existent_media",
          },
          "owner_user"
        )
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "NOT_FOUND",
      });

      // 2. Inserts media in pending state
      const mediaId = "logo_test_1";
      const filename = `${mediaId}.png`;
      const { storage } = await import("../../../../lib/media/storage");
      await storage.savePrivate(filename, Buffer.from("fake-png-content"));

      await tx.insert(media).values({
        id: mediaId,
        filename,
        mimeType: "image/png",
        size: 1024,
        status: "pending",
      });

      const updated = await updateStoreSettings(
        tx,
        {
          store_name: "متجر بيميد",
          support_email: "support@bmadecomm.eg",
          support_phone: "01012345678",
          default_language: "ar-EG",
          currency: "EGP",
          timezone: "Africa/Cairo",
          date_format: "YYYY-MM-DD",
          order_prefix: "ORD-",
          logo_media_id: mediaId,
        },
        "owner_user"
      );

      expect(updated.logo_media_id).toBe(mediaId);
      expect(updated.logo_url).toBe(`/uploads/${mediaId}.png`);

      // Media status should now be active
      const [mediaRecord] = await tx
        .select()
        .from(media)
        .where(eq(media.id, mediaId));
      expect(mediaRecord.status).toBe("active");
    });
  });

  it("returns safe public storefront settings without leaking internal fields (AC-E03-01-06)", async () => {
    await withIsolatedTx(async (tx) => {
      const publicSettings = await getPublicStoreSettings(tx);

      expect(publicSettings.store_name).toBe("متجر بيميد");
      expect(publicSettings.currency).toBe("EGP");
      expect(publicSettings.currency_symbol).toBe("ج.م");
      expect(publicSettings.support_email).toBe("support@bmadecomm.eg");
      expect(publicSettings.timezone).toBe("Africa/Cairo");
      expect(publicSettings.enabled_payment_methods).toEqual([]);

      // Ensure private/internal fields are NOT exposed
      const record = publicSettings as Record<string, unknown>;
      expect(record.updated_by).toBeUndefined();
      expect(record.order_prefix).toBeUndefined();
      expect(record.id).toBeUndefined();
    });
  });
});
