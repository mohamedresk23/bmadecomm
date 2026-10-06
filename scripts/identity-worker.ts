import dotenv from "dotenv";
import { composeIdentityWorker } from "../src/modules/identity/infrastructure/worker";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
async function main() {
  const { db } = await import("../src/db");
  const worker = composeIdentityWorker(db);
  const processed = await worker.runOnce();
  console.log(`Sandbox identity worker processed ${processed} items`);
}
main().then(() => process.exit(0)).catch(() => {
  console.error("Sandbox identity worker failed");
  process.exit(1);
});
