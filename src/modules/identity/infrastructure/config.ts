export function identityConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === "production" || env.EMAIL_ADAPTER !== "sandbox") {
    throw new Error("Sandbox identity configuration required");
  }
  const keyText = env.IDENTITY_TOKEN_KEY ?? "";
  const key = Buffer.from(keyText, "base64");
  if (key.length !== 32 || key.toString("base64") !== keyText) throw new Error("Identity key configuration invalid");
  const url = new URL(env.APP_URL ?? "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Application URL configuration invalid");
  }
  const trustedHeader = env.IDENTITY_TRUSTED_IP_HEADER;
  if (trustedHeader && !/^[a-z][a-z0-9-]*$/.test(trustedHeader)) throw new Error("Trusted header configuration invalid");
  return { key, origin: url.origin, trustedHeader };
}
