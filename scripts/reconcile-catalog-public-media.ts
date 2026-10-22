import path from "node:path";
import fs from "node:fs/promises";
import { db } from "../src/db";
import type { DbContext } from "../src/db/tx";
import { reconcileCatalogPublicCopies } from "../src/lib/media/catalog-public-copies";
import { LocalFileSystemAdapter } from "../src/lib/media/storage";

export async function runCatalogReconciliation(db: DbContext, args: string[], output: (value: string) => void = console.log) {
  const apply = args.includes("--apply");
  const rootIndex = args.indexOf("--storage-root");
  const root = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
  const allowed = new Set(["--apply", "--storage-root"]);
  if (!root || root.startsWith("--") || args.some((arg, index) => index !== rootIndex + 1 && !allowed.has(arg)) || args.filter(arg => arg === "--storage-root").length !== 1 || args.filter(arg => arg === "--apply").length > 1) throw new Error("Usage: --storage-root <absolute deployment root> [--apply]");
  if (!path.isAbsolute(root)) throw new Error("Storage root must be absolute");
  if (!(await fs.stat(root)).isDirectory() || !(await fs.stat(path.join(root, "storage", "private"))).isDirectory()) throw new Error("Existing deployment root and private storage directory required");
  const results = await reconcileCatalogPublicCopies(db, { apply, adapter: new LocalFileSystemAdapter(root) });
  output(JSON.stringify({ mode: apply ? "apply" : "dry-run", storageRoot: path.resolve(root), results }));
  return results.some(result => result.state === "failed" || result.state === "conflict") ? 1 : 0;
}

async function main() {
  try { process.exitCode = await runCatalogReconciliation(db, process.argv.slice(2)); }
  catch { console.error("Catalog media reconciliation failed; check arguments and database availability"); process.exitCode = 1; }
  // The database driver retains a pool. All awaited work is complete here.
  process.exit(process.exitCode ?? 0);
}
if (process.argv[1] && /(?:^|[\\/])reconcile-catalog-public-media\.(?:ts|js)$/.test(process.argv[1])) void main();
