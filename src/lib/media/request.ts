import { ApiError } from "../../shared/api/errors";
import { boundedJson } from "../../shared/api/bounded-json";
import { File as NodeFile } from "node:buffer";

export const MAX_MEDIA_REQUEST_BYTES = 5_308_416;
export async function readMediaFile(request: Request, options: { maxBytes?: number; deadlineMs?: number } = {}): Promise<NodeFile> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Multipart body required");
  const reader = request.body?.getReader();
  if (!reader) throw ApiError.badRequest("File required");
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer!: ReturnType<typeof setTimeout>;
  let abort!: () => void;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(408, "REQUEST_TIMEOUT", "Request body timed out")), options.deadlineMs ?? 10_000);
    abort = () => reject(new ApiError(400, "REQUEST_ABORTED", "Request aborted"));
  });
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > (options.maxBytes ?? MAX_MEDIA_REQUEST_BYTES)) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData(); }
  catch { throw ApiError.badRequest("Malformed multipart body"); }
  const entries = Array.from(form.entries());
  if (entries.length !== 1 || entries[0][0] !== "file" || !(entries[0][1] instanceof NodeFile)) throw ApiError.badRequest("Exactly one file required");
  const file = entries[0][1];
  if (file.size > 5_242_880) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "File too large");
  return file;
}

export async function readPublishId(request: Request): Promise<string> {
  const body = await boundedJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.id !== "string" || !/^[a-z0-9]{1,128}$/i.test(body.id)) throw ApiError.badRequest("Valid media id required");
  return body.id;
}
