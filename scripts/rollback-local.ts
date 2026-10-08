import dotenv from "dotenv";
import { localDatabaseUrl } from "./local-database-config";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

async function main() {
  localDatabaseUrl();
  const { rollbackMigration } = await import("../src/db/migrate");
  const args = process.argv.slice(2);
  const targetArg = args.find((a) => a.startsWith("--target="))?.split("=")[1];
  const stepsArg = args.find((a) => a.startsWith("--steps="))?.split("=")[1];

  await rollbackMigration({
    target: targetArg,
    steps: stepsArg ? parseInt(stepsArg, 10) : 1,
  });
}

main().then(() => process.exit(0)).catch(() => {
  console.error("Local development rollback failed; check private configuration and PostgreSQL availability.");
  process.exit(1);
});

