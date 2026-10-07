import { eq, sql } from "drizzle-orm";
import type { DbContext } from "../../../../db/tx";
import { withTransaction } from "../../../../db/tx";
import { media, storeSettings } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import { writeAudit } from "../../../../shared/authz/audit";
import { storage } from "../../../../lib/media/storage";
import {
  CURRENCY_METADATA,
  type AdminStoreProfileResponse,
  type PublicStoreSettingsDto,
  type StoreProfileDto,
  type StoreProfileUpdateInput,
  type SupportedCurrency,
} from "../contracts/store-profile";

/**
 * Checks if the 'orders' table exists in the database and contains at least one row.
 * Used to enforce the permanent currency lock invariant once store trading begins.
 */
export async function checkOrdersExist(tx: DbContext): Promise<boolean> {
  const tableCheck = await tx.execute(sql`SELECT to_regclass('orders') IS NOT NULL AS exists;`);
  const tableRows = Array.isArray(tableCheck)
    ? (tableCheck as unknown as Record<string, unknown>[])
    : ((tableCheck as unknown as { rows?: Record<string, unknown>[] })?.rows ?? []);
  const tableExists = Boolean(tableRows[0]?.exists);
  if (!tableExists) {
    return false;
  }

  const ordersCheck = await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM orders) AS exists;`);
  const orderRows = Array.isArray(ordersCheck)
    ? (ordersCheck as unknown as Record<string, unknown>[])
    : ((ordersCheck as unknown as { rows?: Record<string, unknown>[] })?.rows ?? []);
  return Boolean(orderRows[0]?.exists);
}

async function resolveLogoUrl(
  tx: DbContext,
  logoMediaId: string | null
): Promise<string | null> {
  if (!logoMediaId) return null;
  const [record] = await tx
    .select({ filename: media.filename })
    .from(media)
    .where(eq(media.id, logoMediaId));
  return record ? `/uploads/${record.filename}` : null;
}

export async function getStoreSettings(
  db: DbContext
): Promise<AdminStoreProfileResponse> {
  let [row] = await db
    .select()
    .from(storeSettings)
    .where(eq(storeSettings.id, "default"));

  if (!row) {
    // If table was unseeded, ensure the singleton default exists
    const [seeded] = await db
      .insert(storeSettings)
      .values({
        id: "default",
        storeName: "متجر بيميد",
        legalName: "شركة التجارة الإلكترونية المصرية ش.ذ.م.م",
        supportEmail: "support@bmadecomm.eg",
        supportPhone: "+201012345678",
        address: "15 شارع مصدق، الدقي، الجيزة، مصر",
        defaultLanguage: "ar-EG",
        currency: "EGP",
        currencySymbol: "ج.م",
        currencyExponent: 2,
        timezone: "Africa/Cairo",
        dateFormat: "YYYY-MM-DD",
        orderPrefix: "ORD-",
      })
      .onConflictDoNothing()
      .returning();

    row = seeded ?? (
      await db.select().from(storeSettings).where(eq(storeSettings.id, "default"))
    )[0];
  }

  const logoUrl = await resolveLogoUrl(db, row.logoMediaId);
  const currencyLocked = await checkOrdersExist(db);

  return {
    profile: {
      store_name: row.storeName,
      legal_name: row.legalName,
      support_email: row.supportEmail,
      support_phone: row.supportPhone,
      address: row.address,
      logo_media_id: row.logoMediaId,
      logo_url: logoUrl,
      default_language: row.defaultLanguage,
      currency: row.currency,
      currency_symbol: row.currencySymbol,
      currency_exponent: row.currencyExponent,
      timezone: row.timezone,
      date_format: row.dateFormat,
      order_prefix: row.orderPrefix,
      updated_at: row.updatedAt.toISOString(),
      updated_by: row.updatedBy,
    },
    currency_locked: currencyLocked,
    currency_locked_reason: currencyLocked
      ? "Orders exist in the store database. Operating currency cannot be modified."
      : null,
  };
}

export async function updateStoreSettings(
  db: DbContext,
  input: StoreProfileUpdateInput,
  actor: string,
  requestId?: string
): Promise<StoreProfileDto> {
  return withTransaction(db, async (tx) => {
    const [current] = await tx
      .select()
      .from(storeSettings)
      .where(eq(storeSettings.id, "default"))
      .for("update");

    if (!current) {
      throw ApiError.notFound("Store settings not found");
    }

    // Currency Lock Guard (AC-E03-01-02 & AC-E03-01-03)
    if (input.currency !== current.currency) {
      const ordersExist = await checkOrdersExist(tx);
      if (ordersExist) {
        throw new ApiError(
          409,
          "CURRENCY_LOCKED_ORDERS_EXIST",
          "Cannot modify currency once orders exist in the database.",
          [
            {
              field: "currency",
              message: `Currency is locked to ${current.currency} because historical orders exist.`,
            },
          ]
        );
      }
    }

    // Logo validation and publishing (AC-E03-01-04)
    let logoUrl: string | null = null;
    if (input.logo_media_id) {
      const [mediaRecord] = await tx
        .select()
        .from(media)
        .where(eq(media.id, input.logo_media_id));

      if (!mediaRecord) {
        throw ApiError.notFound("Media not found");
      }

      if (mediaRecord.status !== "active") {
        await storage.publish(mediaRecord.filename);
        await tx
          .update(media)
          .set({ status: "active" })
          .where(eq(media.id, mediaRecord.id));
      }
      logoUrl = `/uploads/${mediaRecord.filename}`;
    }

    const currencyMeta =
      CURRENCY_METADATA[input.currency as SupportedCurrency] ?? {
        symbol: "ج.م",
        exponent: 2,
      };

    const now = new Date();
    const [updated] = await tx
      .update(storeSettings)
      .set({
        storeName: input.store_name,
        legalName: input.legal_name ?? null,
        supportEmail: input.support_email,
        supportPhone: input.support_phone,
        address: input.address ?? null,
        logoMediaId: input.logo_media_id ?? null,
        defaultLanguage: input.default_language,
        currency: input.currency,
        currencySymbol: currencyMeta.symbol,
        currencyExponent: currencyMeta.exponent,
        timezone: input.timezone,
        dateFormat: input.date_format,
        orderPrefix: input.order_prefix,
        updatedAt: now,
        updatedBy: actor,
      })
      .where(eq(storeSettings.id, "default"))
      .returning();

    // Audit Logging (AC-E03-01-01)
    await writeAudit(tx, {
      actor,
      action: "store_settings.updated",
      resource: "store_settings:default",
      diff: {
        before: {
          store_name: current.storeName,
          legal_name: current.legalName,
          support_email: current.supportEmail,
          support_phone: current.supportPhone,
          address: current.address,
          logo_media_id: current.logoMediaId,
          default_language: current.defaultLanguage,
          currency: current.currency,
          currency_symbol: current.currencySymbol,
          currency_exponent: current.currencyExponent,
          timezone: current.timezone,
          date_format: current.dateFormat,
          order_prefix: current.orderPrefix,
        },
        after: {
          store_name: updated.storeName,
          legal_name: updated.legalName,
          support_email: updated.supportEmail,
          support_phone: updated.supportPhone,
          address: updated.address,
          logo_media_id: updated.logoMediaId,
          default_language: updated.defaultLanguage,
          currency: updated.currency,
          currency_symbol: updated.currencySymbol,
          currency_exponent: updated.currencyExponent,
          timezone: updated.timezone,
          date_format: updated.dateFormat,
          order_prefix: updated.orderPrefix,
        },
      },
      requestId,
    });

    return {
      store_name: updated.storeName,
      legal_name: updated.legalName,
      support_email: updated.supportEmail,
      support_phone: updated.supportPhone,
      address: updated.address,
      logo_media_id: updated.logoMediaId,
      logo_url: logoUrl,
      default_language: updated.defaultLanguage,
      currency: updated.currency,
      currency_symbol: updated.currencySymbol,
      currency_exponent: updated.currencyExponent,
      timezone: updated.timezone,
      date_format: updated.dateFormat,
      order_prefix: updated.orderPrefix,
      updated_at: updated.updatedAt.toISOString(),
      updated_by: updated.updatedBy,
    };
  });
}

export async function getPublicStoreSettings(
  db: DbContext
): Promise<PublicStoreSettingsDto> {
  const [row] = await db
    .select()
    .from(storeSettings)
    .where(eq(storeSettings.id, "default"));

  if (!row) {
    throw ApiError.notFound("Store settings not found");
  }

  const logoUrl = await resolveLogoUrl(db, row.logoMediaId);

  return {
    store_name: row.storeName,
    logo_url: logoUrl,
    support_email: row.supportEmail,
    support_phone: row.supportPhone,
    address: row.address,
    default_language: row.defaultLanguage,
    currency: row.currency,
    currency_symbol: row.currencySymbol,
    timezone: row.timezone,
    enabled_payment_methods: [],
  };
}
