import { SandboxEmailAdapter, type EmailAdapter } from "../../../shared/email/adapter";
import { runOnce } from "../../../shared/outbox/worker";
import type { DbContext } from "../../../db/tx";
import { identityConfig } from "./config";
import { createVerificationEmailHandler } from "./verification-email";

export function composeIdentityWorker<A extends EmailAdapter = SandboxEmailAdapter>(db: DbContext, env: NodeJS.ProcessEnv = process.env, adapter: A = new SandboxEmailAdapter() as unknown as A) {
  const config = identityConfig(env);
  const handlers = { CustomerRegistered: createVerificationEmailHandler(adapter, config) };
  return { adapter, runOnce: () => runOnce(db, { handlers }) };
}
