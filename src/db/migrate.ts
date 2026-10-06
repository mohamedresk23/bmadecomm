import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { db } from "./index";
import path from "path";
import fs from "fs";

export async function runMigrations() {
  // Use relative path resolution starting from cwd (or __dirname depending on execution context)
  const migrationsFolder = path.join(process.cwd(), "src/db/migrations");
  
  if (!fs.existsSync(migrationsFolder)) {
    // Return early if no migrations exist yet
    return;
  }

  console.log("Running migrations...");
  if (process.env.NODE_ENV === "test") {
    // db is Pglite database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migratePglite(db as any, { migrationsFolder });
  } else {
    // db is postgres-js database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migratePg(db as any, { migrationsFolder });
  }
  console.log("Migrations applied successfully.");
}

// Run directly if invoked as script
if (require.main === module) {
  runMigrations().then(() => process.exit(0)).catch(() => {
    console.error("Migration failed");
    process.exit(1);
  });
}
