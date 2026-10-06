import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { parse } from "dotenv";

export function setupIdentity(filename = ".env.local") {
  const existing = existsSync(filename) ? readFileSync(filename, "utf8") : "";
  const settings = parse(existing);
  if (Object.hasOwn(settings, "IDENTITY_TOKEN_KEY")) throw new Error("Identity key already configured; refusing to overwrite");
  const additions = [
    ...(!Object.hasOwn(settings, "EMAIL_ADAPTER") ? ["EMAIL_ADAPTER=sandbox"] : []),
    ...(!Object.hasOwn(settings, "APP_URL") ? ["APP_URL=http://localhost:3000"] : []),
    `IDENTITY_TOKEN_KEY=${randomBytes(32).toString("base64")}`,
  ];
  writeFileSync(filename, `${existing}\n${additions.join("\n")}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(filename, 0o600);
}

if (require.main === module) {
  setupIdentity();
  console.log("Sandbox identity settings saved to ignored .env.local; secret was not printed");
}
