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
    const verification = message.template === 'customer-verification';
    const reset = message.template === 'staff-password-reset';
    const security = message.template === 'staff-security-change';
    if (!verification && !reset && !security) throw new Error('Unsupported sandbox message');
    const rawLink = verification ? message.data.verificationUrl : reset ? message.data.resetUrl : null;
    if (!security && typeof rawLink !== 'string') throw new Error('Unsupported sandbox message');
    const link = typeof rawLink === 'string' ? new URL(rawLink) : null;
    if (link && (!["http:", "https:"].includes(link.protocol) || link.username || link.password || link.search || link.pathname !== (verification ? '/verify-email' : '/admin/reset') || !link.hash)) throw new Error("Invalid sandbox link");
    if (security && (typeof message.data.event !== 'string' || !/^staff\.[a-z.-]+$/.test(message.data.event))) throw new Error('Invalid security event');
    const id = createHash("sha256").update(message.idempotencyKey).digest("hex");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const content = link ? `<a href="${escapeHtml(link.toString())}" rel="noreferrer">${verification ? 'Verify your email' : 'Reset staff password'}</a>` : `Staff security event: ${escapeHtml(String(message.data.event))}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'"><title>Private sandbox email</title></head><body><p>To: ${escapeHtml(message.to)}</p><p>${content}</p></body></html>`;
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
