import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { DbContext } from "../../../../db/tx";
import { withTransaction } from "../../../../db/tx";
import { shippingMethods, shippingZones } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import { writeAudit } from "../../../../shared/authz/audit";
import {
  normalizeGovernorateCode,
  type CheckShippingEligibilityInput,
  type CreateShippingMethodInput,
  type CreateShippingZoneInput,
  type ShippingEligibilityResultDto,
  type ShippingMethodDto,
  type ShippingZoneDto,
  type UpdateShippingMethodInput,
  type UpdateShippingZoneInput,
} from "../contracts/shipping";

function formatCost(costMinor: number): string {
  return `${(costMinor / 100).toFixed(2)} ج.م`;
}

function mapMethodDto(m: typeof shippingMethods.$inferSelect): ShippingMethodDto {
  return {
    id: m.id,
    zone_id: m.zoneId,
    name_ar: m.nameAr,
    name_en: m.nameEn,
    cost_minor: m.costMinor,
    cost_formatted: formatCost(m.costMinor),
    estimated_days_min: m.estimatedDaysMin,
    estimated_days_max: m.estimatedDaysMax,
    is_active: m.isActive,
    created_at: m.createdAt.toISOString(),
    updated_at: m.updatedAt.toISOString(),
  };
}

/**
 * Validates that no governorate in the provided list is already active in another zone (AC-E03-02-02).
 */
export async function validateGovernorateExclusivity(
  tx: DbContext,
  governorates: string[],
  excludeZoneId?: string
): Promise<void> {
  const activeZones = await tx
    .select()
    .from(shippingZones)
    .where(eq(shippingZones.isActive, true));

  for (const zone of activeZones) {
    if (excludeZoneId && zone.id === excludeZoneId) {
      continue;
    }

    const zoneGovs = new Set(zone.governorates.map((g) => g.toLowerCase()));
    for (const gov of governorates) {
      if (zoneGovs.has(gov.toLowerCase())) {
        throw new ApiError(
          422,
          "GOVERNORATE_ALREADY_ASSIGNED",
          "One or more governorates are already assigned to active shipping zones.",
          [
            {
              field: "governorates",
              message: `Governorate '${gov}' is already assigned to zone '${zone.nameAr}'.`,
            },
          ]
        );
      }
    }
  }
}

export async function listShippingZones(
  db: DbContext
): Promise<ShippingZoneDto[]> {
  const zones = await db.select().from(shippingZones);
  const methods = await db.select().from(shippingMethods);

  return zones.map((zone) => {
    const zoneMethods = methods
      .filter((m) => m.zoneId === zone.id)
      .map(mapMethodDto);

    return {
      id: zone.id,
      name_ar: zone.nameAr,
      name_en: zone.nameEn,
      country_code: zone.countryCode,
      governorates: zone.governorates,
      is_active: zone.isActive,
      methods: zoneMethods,
      created_at: zone.createdAt.toISOString(),
      updated_at: zone.updatedAt.toISOString(),
    };
  });
}

export async function createShippingZone(
  db: DbContext,
  input: CreateShippingZoneInput,
  actor: string,
  requestId?: string
): Promise<ShippingZoneDto> {
  return withTransaction(db, async (tx) => {
    if (input.is_active !== false) {
      await validateGovernorateExclusivity(tx, input.governorates);
    }

    const id = `zone_${createId()}`;
    const now = new Date();

    const [created] = await tx
      .insert(shippingZones)
      .values({
        id,
        nameAr: input.name_ar,
        nameEn: input.name_en,
        countryCode: input.country_code,
        governorates: input.governorates,
        isActive: input.is_active,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await writeAudit(tx, {
      actor,
      action: "shipping_zone.created",
      resource: `shipping_zone:${id}`,
      diff: {
        after: created,
      },
      requestId,
    });

    return {
      id: created.id,
      name_ar: created.nameAr,
      name_en: created.nameEn,
      country_code: created.countryCode,
      governorates: created.governorates,
      is_active: created.isActive,
      methods: [],
      created_at: created.createdAt.toISOString(),
      updated_at: created.updatedAt.toISOString(),
    };
  });
}

export async function updateShippingZone(
  db: DbContext,
  zoneId: string,
  input: UpdateShippingZoneInput,
  actor: string,
  requestId?: string
): Promise<ShippingZoneDto> {
  return withTransaction(db, async (tx) => {
    const [current] = await tx
      .select()
      .from(shippingZones)
      .where(eq(shippingZones.id, zoneId))
      .for("update");

    if (!current) {
      throw ApiError.notFound("Shipping zone not found");
    }

    const targetGovernorates = input.governorates ?? current.governorates;
    const targetIsActive = input.is_active ?? current.isActive;

    if (targetIsActive) {
      await validateGovernorateExclusivity(tx, targetGovernorates, zoneId);
    }

    const now = new Date();
    const [updated] = await tx
      .update(shippingZones)
      .set({
        nameAr: input.name_ar ?? current.nameAr,
        nameEn: input.name_en ?? current.nameEn,
        countryCode: input.country_code ?? current.countryCode,
        governorates: targetGovernorates,
        isActive: targetIsActive,
        updatedAt: now,
      })
      .where(eq(shippingZones.id, zoneId))
      .returning();

    await writeAudit(tx, {
      actor,
      action: "shipping_zone.updated",
      resource: `shipping_zone:${zoneId}`,
      diff: {
        before: current,
        after: updated,
      },
      requestId,
    });

    const methods = await tx
      .select()
      .from(shippingMethods)
      .where(eq(shippingMethods.zoneId, zoneId));

    return {
      id: updated.id,
      name_ar: updated.nameAr,
      name_en: updated.nameEn,
      country_code: updated.countryCode,
      governorates: updated.governorates,
      is_active: updated.isActive,
      methods: methods.map(mapMethodDto),
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    };
  });
}

export async function deleteShippingZone(
  db: DbContext,
  zoneId: string,
  actor: string,
  requestId?: string
): Promise<void> {
  return withTransaction(db, async (tx) => {
    const [current] = await tx
      .select()
      .from(shippingZones)
      .where(eq(shippingZones.id, zoneId))
      .for("update");

    if (!current) {
      throw ApiError.notFound("Shipping zone not found");
    }

    await tx.delete(shippingZones).where(eq(shippingZones.id, zoneId));

    await writeAudit(tx, {
      actor,
      action: "shipping_zone.deleted",
      resource: `shipping_zone:${zoneId}`,
      diff: {
        before: current,
      },
      requestId,
    });
  });
}

export async function createShippingMethod(
  db: DbContext,
  input: CreateShippingMethodInput,
  actor: string,
  requestId?: string
): Promise<ShippingMethodDto> {
  return withTransaction(db, async (tx) => {
    const [zone] = await tx
      .select()
      .from(shippingZones)
      .where(eq(shippingZones.id, input.zone_id));

    if (!zone) {
      throw ApiError.notFound("Shipping zone not found");
    }

    const id = `sm_${createId()}`;
    const now = new Date();

    const [created] = await tx
      .insert(shippingMethods)
      .values({
        id,
        zoneId: input.zone_id,
        nameAr: input.name_ar,
        nameEn: input.name_en,
        costMinor: input.cost_minor,
        estimatedDaysMin: input.estimated_days_min,
        estimatedDaysMax: input.estimated_days_max,
        isActive: input.is_active,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await writeAudit(tx, {
      actor,
      action: "shipping_method.created",
      resource: `shipping_method:${id}`,
      diff: {
        after: created,
      },
      requestId,
    });

    return mapMethodDto(created);
  });
}

export async function updateShippingMethod(
  db: DbContext,
  methodId: string,
  input: UpdateShippingMethodInput,
  actor: string,
  requestId?: string
): Promise<ShippingMethodDto> {
  return withTransaction(db, async (tx) => {
    const [current] = await tx
      .select()
      .from(shippingMethods)
      .where(eq(shippingMethods.id, methodId))
      .for("update");

    if (!current) {
      throw ApiError.notFound("Shipping method not found");
    }

    const now = new Date();
    const [updated] = await tx
      .update(shippingMethods)
      .set({
        nameAr: input.name_ar ?? current.nameAr,
        nameEn: input.name_en ?? current.nameEn,
        costMinor: input.cost_minor ?? current.costMinor,
        estimatedDaysMin: input.estimated_days_min ?? current.estimatedDaysMin,
        estimatedDaysMax: input.estimated_days_max ?? current.estimatedDaysMax,
        isActive: input.is_active ?? current.isActive,
        updatedAt: now,
      })
      .where(eq(shippingMethods.id, methodId))
      .returning();

    await writeAudit(tx, {
      actor,
      action: "shipping_method.updated",
      resource: `shipping_method:${methodId}`,
      diff: {
        before: current,
        after: updated,
      },
      requestId,
    });

    return mapMethodDto(updated);
  });
}

export async function deleteShippingMethod(
  db: DbContext,
  methodId: string,
  actor: string,
  requestId?: string
): Promise<void> {
  return withTransaction(db, async (tx) => {
    const [current] = await tx
      .select()
      .from(shippingMethods)
      .where(eq(shippingMethods.id, methodId))
      .for("update");

    if (!current) {
      throw ApiError.notFound("Shipping method not found");
    }

    await tx.delete(shippingMethods).where(eq(shippingMethods.id, methodId));

    await writeAudit(tx, {
      actor,
      action: "shipping_method.deleted",
      resource: `shipping_method:${methodId}`,
      diff: {
        before: current,
      },
      requestId,
    });
  });
}

/**
 * Server-side evaluation query checking if an address is serviced and returning applicable methods (AC-E03-02-03, AC-E03-02-04).
 * Exported for Cart (Epic 09) and Checkout (Epic 10).
 */
export async function checkShippingEligibility(
  db: DbContext,
  address: CheckShippingEligibilityInput,
  specificMethodId?: string
): Promise<ShippingEligibilityResultDto> {
  const normalizedGov = normalizeGovernorateCode(address.governorate);

  if (!normalizedGov) {
    return {
      is_eligible: false,
      reason: `عذرًا، المحافظة المحددة غير صالحة أو غير معروفة (${address.governorate}).`,
      available_methods: [],
    };
  }

  // Find active zone covering this governorate
  const activeZones = await db
    .select()
    .from(shippingZones)
    .where(eq(shippingZones.isActive, true));

  const matchedZone = activeZones.find((zone) =>
    zone.governorates.some((g) => g.toLowerCase() === normalizedGov)
  );

  if (!matchedZone) {
    return {
      is_eligible: false,
      reason: `عذرًا، التوصيل غير متاح حاليًا لهذه المحافظة (${address.governorate}).`,
      available_methods: [],
    };
  }

  // Fetch active methods for this zone
  const methods = await db
    .select()
    .from(shippingMethods)
    .where(eq(shippingMethods.zoneId, matchedZone.id));

  const activeMethods = methods
    .filter((m) => m.isActive)
    .map((m) => ({
      method_id: m.id,
      name: m.nameAr,
      cost_minor: m.costMinor,
      cost_formatted: formatCost(m.costMinor),
      estimated_days_min: m.estimatedDaysMin,
      estimated_days_max: m.estimatedDaysMax,
    }));

  if (activeMethods.length === 0) {
    return {
      is_eligible: false,
      reason: `عذرًا، لا توجد طرق توصيل متاحة حاليًا لمنطقة ${matchedZone.nameAr}.`,
      available_methods: [],
    };
  }

  if (specificMethodId) {
    const foundSpecific = activeMethods.find((m) => m.method_id === specificMethodId);
    if (!foundSpecific) {
      return {
        is_eligible: false,
        reason: "طريقة الشحن المحددة غير متاحة أو غير مفعّلة لهذه المنطقة.",
        available_methods: [],
      };
    }
  }

  return {
    is_eligible: true,
    zone_name: matchedZone.nameAr,
    available_methods: activeMethods,
  };
}

