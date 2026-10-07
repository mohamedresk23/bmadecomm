import { createHash, randomUUID } from "node:crypto";
import { link as linkFile, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EmailAdapter, EmailMessage } from "./adapter";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Private, inspectable CLI sandbox. Files contain bearer secrets; never serve this directory. */
export class FileSandboxEmailAdapter implements EmailAdapter {
  readonly directory = path.resolve(process.cwd(), ".local", "sandbox-mail");
  async send(message: EmailMessage) {
    if (process.env.NODE_ENV === "production") throw new Error("Private sandbox delivery unavailable");
    if (message.template !== "customer-verification" || typeof message.data.verificationUrl !== "string") throw new Error("Unsupported sandbox message");
    const link = new URL(message.data.verificationUrl);
    if (!["http:", "https:"].includes(link.protocol) || link.username || link.password || link.search || link.pathname !== "/verify-email" || !link.hash) throw new Error("Invalid sandbox link");
    const id = createHash("sha256").update(message.idempotencyKey).digest("hex");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'"><title>Sandbox verification email</title></head><body><p>To: ${escapeHtml(message.to)}</p><p><a href="${escapeHtml(link.toString())}" rel="noreferrer">Verify your email</a></p></body></html>`;
    const temporary = path.join(this.directory, `${id}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, html, { flag: "wx", mode: 0o600 });
      // Publish only a complete file. The hard-link operation never replaces a winner.
      try { await linkFile(temporary, path.join(this.directory, `${id}.html`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } catch { throw new Error("Private sandbox delivery failed"); }
    finally { await unlink(temporary).catch(() => {}); }
    return { providerMessageId: `file-sandbox-${id}` };
  }
}
