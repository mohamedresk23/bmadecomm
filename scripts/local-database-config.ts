/** Refuse remote, production, test substitutes, and non-dedicated databases. */
export function localDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === "production" || env.NODE_ENV === "test") throw new Error("Local development database required");
  const url = new URL(env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || url.search || url.hash
    || !/^\/bmadecomm_[a-z0-9_]*dev[a-z0-9_]*$/.test(url.pathname)
    || !/^bmadecomm_[a-z0-9_]+$/.test(decodeURIComponent(url.username)) || !url.password) {
    throw new Error("Local development database required");
  }
  return url.toString();
}
