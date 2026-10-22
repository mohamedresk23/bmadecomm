import { sql } from "drizzle-orm";
import type { DbContext } from "../../db/tx";
import { media, productMedia } from "../../db/schema";

/** Conservative for legacy aliases on case-insensitive deployment volumes. */
export const sameMediaStorageKey = (first: string, second: string) => first.toLowerCase() === second.toLowerCase();

export async function catalogOwnsStorageKey(db: DbContext, filename: string): Promise<boolean> {
  const owners = await db.select({ id: productMedia.id }).from(productMedia)
    .innerJoin(media, sql`${productMedia.mediaId} = ${media.id}`)
    .where(sql`lower(${media.filename}) = ${filename.toLowerCase()}`).limit(1);
  return owners.length > 0;
}
