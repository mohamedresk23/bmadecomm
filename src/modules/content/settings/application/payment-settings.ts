import { eq } from "drizzle-orm";
import type { DbContext } from "../../../../db/tx";
import { withTransaction } from "../../../../db/tx";
import { paymentMethodConfigs } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import * as auditModule from "../../../../shared/authz/audit";
import {
  defaultReadinessProvider,
  type PaymentMethodConfigDto,
  type PaymentMethodConfigUpdateInput,
  type PaymentMethodId,
  type PaymentMethodReadinessStatus,
  type PaymentReadinessProvider,
} from "../contracts/payment-settings";

function mapPaymentMethodConfigDto(
  row: typeof paymentMethodConfigs.$inferSelect,
  readiness: { is_ready: boolean; readiness_reason: PaymentMethodReadinessStatus }
): PaymentMethodConfigDto {
  return {
    id: row.id as PaymentMethodId,
    title_ar: row.titleAr,
    title_en: row.titleEn,
    instructions_ar: row.instructionsAr,
    instructions_en: row.instructionsEn,
    is_enabled: row.isEnabled,
    min_order_subtotal_minor:
      row.minOrderSubtotalMinor !== null
        ? String(row.minOrderSubtotalMinor)
        : null,
    max_order_subtotal_minor:
      row.maxOrderSubtotalMinor !== null
        ? String(row.maxOrderSubtotalMinor)
        : null,
    version: row.version,
    updated_at: new Date(row.updatedAt).toISOString(),
    updated_by: row.updatedBy,
    currency: "EGP",
    currency_exponent: 2,
    is_ready: readiness.is_ready,
    readiness_reason: readiness.readiness_reason,
  };
}

/**
 * Lists all configured payment methods in canonical order ('cod' then 'online_card').
 * Requires both baseline rows to be seeded; missing rows indicates configuration fault.
 */
export async function listConfiguredMethods(
  tx: DbContext,
  readinessProvider: PaymentReadinessProvider = defaultReadinessProvider
): Promise<PaymentMethodConfigDto[]> {
  const rows = await tx.select().from(paymentMethodConfigs);
  const codRow = rows.find((r) => r.id === "cod");
  const onlineRow = rows.find((r) => r.id === "online_card");

  if (!codRow || !onlineRow) {
    throw ApiError.internal("Payment methods registry configuration incomplete");
  }

  const codReadiness = await readinessProvider.getReadiness("cod");
  const onlineReadiness = await readinessProvider.getReadiness("online_card");

  return [
    mapPaymentMethodConfigDto(codRow, codReadiness),
    mapPaymentMethodConfigDto(onlineRow, onlineReadiness),
  ];
}

/**
 * Updates a payment method configuration with optimistic row locking (FOR UPDATE)
 * and records an atomic append-only audit event in the same transaction.
 */
export async function updatePaymentMethodConfig(
  db: DbContext,
  actorId: string,
  methodId: string,
  input: PaymentMethodConfigUpdateInput,
  requestId?: string,
  readinessProvider: PaymentReadinessProvider = defaultReadinessProvider
): Promise<PaymentMethodConfigDto> {
  if (methodId !== "cod" && methodId !== "online_card") {
    throw ApiError.notFound("Payment method not found");
  }

  return withTransaction(db, async (tx) => {
    const [current] = await tx
      .select()
      .from(paymentMethodConfigs)
      .where(eq(paymentMethodConfigs.id, methodId))
      .for("update");

    if (!current) {
      throw ApiError.notFound("Payment method not found");
    }

    // Optimistic concurrency check (409 on mismatch)
    if (input.expected_version !== current.version) {
      throw new ApiError(
        409,
        "STALE_PAYMENT_METHOD_CONFIG",
        "Payment method configuration was modified by another request. Please reload and retry."
      );
    }

    // Merge partial edits
    const titleAr = input.title_ar !== undefined ? input.title_ar : current.titleAr;
    const titleEn = input.title_en !== undefined ? input.title_en : current.titleEn;
    const instructionsAr =
      input.instructions_ar !== undefined
        ? input.instructions_ar
        : current.instructionsAr;
    const instructionsEn =
      input.instructions_en !== undefined
        ? input.instructions_en
        : current.instructionsEn;
    const isEnabled =
      input.is_enabled !== undefined ? input.is_enabled : current.isEnabled;

    const minMinor =
      input.min_order_subtotal_minor !== undefined
        ? input.min_order_subtotal_minor === null
          ? null
          : parseInt(input.min_order_subtotal_minor, 10)
        : current.minOrderSubtotalMinor;

    const maxMinor =
      input.max_order_subtotal_minor !== undefined
        ? input.max_order_subtotal_minor === null
          ? null
          : parseInt(input.max_order_subtotal_minor, 10)
        : current.maxOrderSubtotalMinor;

    // Enforce min <= max on merged values
    if (minMinor !== null && maxMinor !== null && minMinor > maxMinor) {
      throw ApiError.unprocessableEntity(
        "Minimum subtotal bound cannot exceed maximum subtotal bound",
        [
          {
            field: "min_order_subtotal_minor",
            message: `Minimum subtotal bound (${minMinor}) cannot exceed maximum subtotal bound (${maxMinor})`,
          },
        ]
      );
    }

    const newVersion = current.version + 1;
    const now = new Date();

    const [updated] = await tx
      .update(paymentMethodConfigs)
      .set({
        titleAr,
        titleEn,
        instructionsAr,
        instructionsEn,
        isEnabled,
        minOrderSubtotalMinor: minMinor,
        maxOrderSubtotalMinor: maxMinor,
        version: newVersion,
        updatedAt: now,
        updatedBy: actorId,
      })
      .where(eq(paymentMethodConfigs.id, methodId))
      .returning();

    // Atomic append-only audit event in the same transaction
    await auditModule.writeAudit(tx, {
      actor: actorId,
      action: "payment_method_config.updated",
      resource: `payment_method_config:${methodId}`,
      diff: {
        before: {
          title_ar: current.titleAr,
          title_en: current.titleEn,
          instructions_ar: current.instructionsAr,
          instructions_en: current.instructionsEn,
          is_enabled: current.isEnabled,
          min_order_subtotal_minor:
            current.minOrderSubtotalMinor !== null
              ? String(current.minOrderSubtotalMinor)
              : null,
          max_order_subtotal_minor:
            current.maxOrderSubtotalMinor !== null
              ? String(current.maxOrderSubtotalMinor)
              : null,
          version: current.version,
        },
        after: {
          title_ar: updated.titleAr,
          title_en: updated.titleEn,
          instructions_ar: updated.instructionsAr,
          instructions_en: updated.instructionsEn,
          is_enabled: updated.isEnabled,
          min_order_subtotal_minor:
            updated.minOrderSubtotalMinor !== null
              ? String(updated.minOrderSubtotalMinor)
              : null,
          max_order_subtotal_minor:
            updated.maxOrderSubtotalMinor !== null
              ? String(updated.maxOrderSubtotalMinor)
              : null,
          version: updated.version,
        },
      },
      requestId,
    });

    const readiness = await readinessProvider.getReadiness(
      methodId as PaymentMethodId
    );
    return mapPaymentMethodConfigDto(updated, readiness);
  });
}

export class PaymentSettingsService {
  static listConfiguredMethods = listConfiguredMethods;
  static updatePaymentMethodConfig = updatePaymentMethodConfig;
}

