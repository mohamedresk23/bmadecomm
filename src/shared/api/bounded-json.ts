import { ApiError } from './errors';

export async function boundedJson(req: Request) {
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON content type required");
  }
  const reader = req.body?.getReader();
  if (!reader) throw ApiError.badRequest("JSON body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  let abortRead!: () => void;
  let timer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ApiError(408, "REQUEST_TIMEOUT", "Request body timed out")), 10000);
    abortRead = () => reject(new ApiError(400, "REQUEST_ABORTED", "Request aborted"));
  });
  req.signal?.addEventListener("abort", abortRead, { once: true });
  if (req.signal?.aborted) abortRead();
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      length += value.byteLength;
      if (length > 8192) {
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    // Cancellation callbacks can stall too; do not await cancellation before responding.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw ApiError.badRequest("Malformed JSON"); }
}
