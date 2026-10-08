// import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { db } from "./index";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

export interface MigrationOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
  migrationsFolder?: string;
  quiet?: boolean;
}

export interface RollbackOptions extends MigrationOptions {
  steps?: number;
  target?: string;
}

export interface MigrationJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

export interface MigrationJournal {
  version: string;
  dialect: string;
  entries: MigrationJournalEntry[];
}

export interface AppliedMigration {
  id: number;
  hash: string;
  createdAt: number;
  tag?: string;
}

export const DEFAULT_MIGRATIONS_FOLDER = path.join(process.cwd(), "src/db/migrations");

export function readJournal(migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER): MigrationJournal {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    return { version: "7", dialect: "postgresql", entries: [] };
  }
  const raw = fs.readFileSync(journalPath, "utf-8");
  return JSON.parse(raw) as MigrationJournal;
}

export function parseSqlStatements(sqlContent: string): string[] {
  if (sqlContent.includes("--> statement-breakpoint")) {
    return sqlContent
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return sqlContent
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function getAppliedMigrations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetDb: any = defaultDb,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER
): Promise<AppliedMigration[]> {
  try {
    const checkTable = await targetDb.execute(
      sql.raw(`
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.tables 
          WHERE table_schema = 'drizzle' 
          AND table_name = '__drizzle_migrations'
        ) as exists
      `)
    );
    const rowsExists = Array.isArray(checkTable) ? checkTable : checkTable?.rows ?? [];
    const exists = rowsExists.length > 0 && Boolean(rowsExists[0]?.exists);
    if (!exists) {
      return [];
    }

    const res = await targetDb.execute(
      sql.raw(`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at ASC`)
    );
    const rows = Array.isArray(res) ? res : res?.rows ?? [];

    const journal = readJournal(migrationsFolder);
    const tagByWhen = new Map<number, string>();
    for (const entry of journal.entries) {
      tagByWhen.set(Number(entry.when), entry.tag);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((r: any) => ({
      id: Number(r.id),
      hash: String(r.hash),
      createdAt: Number(r.created_at),
      tag: tagByWhen.get(Number(r.created_at)),
    }));
  } catch {
    return [];
  }
}

export async function getPendingMigrations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetDb: any = defaultDb,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER
): Promise<MigrationJournalEntry[]> {
  const applied = await getAppliedMigrations(targetDb, migrationsFolder);
  const appliedWhens = new Set(applied.map((a) => a.createdAt));
  const journal = readJournal(migrationsFolder);
  return journal.entries.filter((entry) => !appliedWhens.has(Number(entry.when)));
}

export async function runMigrations(options: MigrationOptions = {}) {
  const migrationsFolder = options.migrationsFolder || DEFAULT_MIGRATIONS_FOLDER;
  const targetDb = options.db || defaultDb;
  const quiet = options.quiet ?? false;

  if (!fs.existsSync(migrationsFolder)) {
    return { applied: [] };
  }

  const pendingBefore = await getPendingMigrations(targetDb, migrationsFolder);
  if (pendingBefore.length === 0) {
    if (!quiet) {
      console.log("No pending migrations to apply.");
    }
    return { applied: [] };
  }

  console.log("Running migrations...");
  if (process.env.NODE_ENV === "test") {
    // db is Pglite database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migratePg(targetDb as any, { migrationsFolder });
  }

  const appliedTags = pendingBefore.map((p) => p.tag);
  if (!quiet) {
    console.log(`Migrations applied successfully: ${appliedTags.join(", ")}`);
  }

  return { applied: appliedTags };
}

export async function rollbackMigration(options: RollbackOptions = {}) {
  const migrationsFolder = options.migrationsFolder || DEFAULT_MIGRATIONS_FOLDER;
  const targetDb = options.db || defaultDb;
  const quiet = options.quiet ?? false;

  const applied = await getAppliedMigrations(targetDb, migrationsFolder);
  if (applied.length === 0) {
    if (!quiet) {
      console.log("No applied migrations to rollback.");
    }
    return { rolledBack: [] };
  }

  let migrationsToRollback: AppliedMigration[] = [];

  if (options.target !== undefined) {
    const targetTag = options.target.trim();
    if (targetTag === "0" || targetTag === "none" || targetTag === "") {
      migrationsToRollback = [...applied].reverse();
    } else {
      const targetIndex = applied.findIndex(
        (a) => a.tag === targetTag || (a.tag && a.tag.startsWith(targetTag))
      );
      if (targetIndex === -1) {
        throw new Error(
          `Target migration "${options.target}" was not found in applied migrations list.`
        );
      }
      migrationsToRollback = applied.slice(targetIndex + 1).reverse();
    }
  } else {
    const steps = options.steps ?? 1;
    if (steps <= 0) {
      return { rolledBack: [] };
    }
    migrationsToRollback = applied.slice(-steps).reverse();
  }

  if (migrationsToRollback.length === 0) {
    if (!quiet) {
      console.log("Database is already at or before requested rollback target.");
    }
    return { rolledBack: [] };
  }

  const rolledBack: string[] = [];

  for (const item of migrationsToRollback) {
    const tag = item.tag;
    if (!tag) {
      throw new Error(
        `Cannot rollback migration with unknown tag for created_at=${item.createdAt}`
      );
    }

    const downFilePath = path.join(migrationsFolder, `${tag}.down.sql`);
    if (!fs.existsSync(downFilePath)) {
      throw new Error(
        `Missing down migration file for "${tag}". Rollback aborted to prevent partial schema state.`
      );
    }

    const sqlContent = fs.readFileSync(downFilePath, "utf-8");
    const statements = parseSqlStatements(sqlContent);

    if (!quiet) {
      console.log(`Rolling back migration: ${tag}...`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await targetDb.transaction(async (tx: any) => {
      for (const statement of statements) {
        const trimmed = statement.trim();
        if (trimmed) {
          await tx.execute(sql.raw(trimmed));
        }
      }
      await tx.execute(
        sql.raw(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${item.createdAt}`)
      );
    });

    rolledBack.push(tag);
    if (!quiet) {
      console.log(`Successfully rolled back migration: ${tag}`);
    }
  }

  return { rolledBack };
}

// Run directly if invoked as script
const isCliEntry = () => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
};

if (isCliEntry()) {
  const args = process.argv.slice(2);
  const isDown = args.includes("down") || args.includes("--down");
  const targetArg = args.find((a) => a.startsWith("--target="))?.split("=")[1];
  const stepsArg = args.find((a) => a.startsWith("--steps="))?.split("=")[1];

  const action = isDown
    ? rollbackMigration({
        target: targetArg,
        steps: stepsArg ? parseInt(stepsArg, 10) : 1,
      })
    : runMigrations();

  action
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration command failed:", err);
      process.exit(1);
    });
}
