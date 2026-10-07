import dotenv from "dotenv";
import { localDatabaseUrl } from "./local-database-config";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
async function main() {
  localDatabaseUrl();
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
}
main().then(() => process.exit(0)).catch(() => {
  console.error("Local development migration failed; check private configuration and PostgreSQL availability.");
  process.exit(1);
});
