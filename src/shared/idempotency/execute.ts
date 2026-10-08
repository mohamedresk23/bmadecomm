import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { operationKeys } from "../../db/schema";
import { type DbContext, withTransaction } from "../../db/tx";
import { ApiError } from "../api/errors";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
function validateString(value: string) {
  // PostgreSQL jsonb rejects NUL and unpaired UTF-16 surrogates.
  if (/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
    throw ApiError.badRequest("Expected PostgreSQL-compatible JSON string");
}
export function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (typeof value === "string") validateString(value);
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object" || seen.has(value)) throw ApiError.badRequest("Expected finite, acyclic JSON");
  seen.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length) throw ApiError.badRequest("Expected JSON keys");
    if (Array.isArray(value)) {
      if (Object.getOwnPropertyNames(value).length !== value.length + 1)
        throw ApiError.badRequest("Expected JSON array properties");
      if (Object.keys(value).length !== value.length || Object.keys(value).some((k, i) => k !== String(i)))
        throw ApiError.badRequest("Expected dense JSON array");
      if (Object.keys(value).some(k => {
        const d = Object.getOwnPropertyDescriptor(value, k)!;
        return d.get || d.set || !d.enumerable;
      })) throw ApiError.badRequest("Expected JSON data properties");
      return `[${value.map(v => canonicalJson(v, seen)).join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw ApiError.badRequest("Expected plain JSON object");
    if (Object.values(Object.getOwnPropertyDescriptors(value)).some(d => d.get || d.set || !d.enumerable))
      throw ApiError.badRequest("Expected JSON data properties");
    return `{${Object.keys(value).sort().map(k => {
      validateString(k);
      return `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k], seen)}`;
    }).join(",")}}`;
  } finally { seen.delete(value); }
}

/** Authenticate/authorize BEFORE calling. Local work only: no network/provider calls.
 * Results MUST exclude credentials, bearer/proof tokens and other secrets; this
 * semantic constraint belongs to the consumer and cannot be inferred from JSON.
 */
export async function executeIdempotent<T extends Json>(context: DbContext,
  input: { actor: string; operation: string; key: string; payload: Json },
  callback: (tx: DbContext) => Promise<T>): Promise<T> {
  for (const value of [input.actor, input.operation, input.key]) {
    if (typeof value !== "string" || !value.length || Buffer.byteLength(value, "utf8") > 128)
      throw ApiError.badRequest("Idempotency scope fields must contain 1–128 UTF-8 bytes");
    validateString(value);
  }
  const payloadHash = createHash("sha256").update(canonicalJson(input.payload)).digest("hex");
  return withTransaction(context, async tx => {
    await tx.insert(operationKeys).values({ id: randomUUID(), actor: input.actor, operation: input.operation,
      key: input.key, payloadHash }).onConflictDoNothing({ target: [operationKeys.actor, operationKeys.operation, operationKeys.key] });
    const [row] = await tx.select().from(operationKeys).where(and(eq(operationKeys.actor, input.actor),
      eq(operationKeys.operation, input.operation), eq(operationKeys.key, input.key))).for("update");
    if (row.payloadHash !== payloadHash) throw ApiError.conflict("Idempotency payload mismatch");
    if (row.completedAt) return row.result as T;
    const result = JSON.parse(canonicalJson(await callback(tx))) as T;
    await tx.update(operationKeys).set({ result, completedAt: sql`clock_timestamp()` }).where(eq(operationKeys.id, row.id));
    return result;
  });
}
