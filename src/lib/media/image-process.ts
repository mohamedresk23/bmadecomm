import { spawn } from "node:child_process";
import path from "node:path";
import { ApiError } from "../../shared/api/errors";

export const IMAGE_PROCESSING_DEADLINE_MS = 10_000;
export const imageWorkerPath = () => path.resolve(process.cwd(), "src/lib/media/image-worker.cjs");

let activeWorkers = 0;
const waiters: Array<() => void> = [];
function acquireWorker(signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { remove(); reject(new ApiError(503, "SERVER_BUSY", "Image processing is busy; retry later")); }, 15_000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const remove = () => { const index = waiters.indexOf(start); if (index >= 0) waiters.splice(index, 1); cleanup(); };
    const abort = () => { remove(); reject(new ApiError(400, "REQUEST_ABORTED", "Request aborted")); };
    const start = () => {
      cleanup(); activeWorkers++;
      let released = false;
      resolve(() => { if (released) return; released = true; activeWorkers--; waiters.shift()?.(); });
    };
    if (signal?.aborted) { abort(); return; }
    if (activeWorkers < 4) { start(); return; }
    waiters.push(start);
    signal?.addEventListener("abort", abort, { once: true });

  });
}

export async function processImage(bytes: Buffer, mime: string, signal?: AbortSignal, options: { deadlineMs?: number; workerPath?: string; onExit?: (pid: number | undefined) => void; onMetrics?: (metrics: {peakRssKiB:number;elapsedMs:number}) => void } = {}): Promise<Buffer> {
  if (signal?.aborted) throw new ApiError(400, "REQUEST_ABORTED", "Request aborted");
  const release = await acquireWorker(signal);
  try { return await new Promise<Buffer>((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [options.workerPath ?? imageWorkerPath()], { windowsHide: true, env: { NODE_ENV: process.env.NODE_ENV, SystemRoot: process.env.SystemRoot, PATH: process.env.PATH }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    let result: Buffer | undefined;
    let failure: ApiError | undefined;
    const stop = (error: ApiError) => { failure ??= error; child.kill("SIGKILL"); };
    const abort = () => stop(new ApiError(400, "REQUEST_ABORTED", "Request aborted"));
    const timer = setTimeout(() => stop(new ApiError(408, "IMAGE_TIMEOUT", "Image processing timed out")), options.deadlineMs ?? IMAGE_PROCESSING_DEADLINE_MS);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.on("message", (message: { error?: string; bytes?: string; peakRssKiB?: number }) => {
      if (failure) return;
      if (message.error) failure = new ApiError(message.error === "IMAGE_POLICY" ? 422 : 415, message.error, "Image is invalid or exceeds image policy");
      else if (typeof message.bytes === "string") {
        result = Buffer.from(message.bytes, "base64");
        if (typeof message.peakRssKiB === "number") options.onMetrics?.({peakRssKiB:message.peakRssKiB,elapsedMs:performance.now()-started});
      }
    });
    child.on("error", () => { failure ??= new ApiError(503, "IMAGE_UNAVAILABLE", "Image processing unavailable"); });
    child.once("close", (code) => {
      release();
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      options.onExit?.(child.pid);
      if (failure) reject(failure);
      else if (code !== 0 || !result?.length) reject(new ApiError(503, "IMAGE_UNAVAILABLE", "Image processing unavailable"));
      else resolve(result);
    });
    try { child.send({ bytes: bytes.toString("base64"), mime }, (error) => { if (error) stop(new ApiError(503, "IMAGE_UNAVAILABLE", "Image processing unavailable")); }); } catch { stop(new ApiError(503, "IMAGE_UNAVAILABLE", "Image processing unavailable")); }
  }); } catch (error) { release(); throw error instanceof ApiError ? error : new ApiError(503, "IMAGE_UNAVAILABLE", "Image processing unavailable"); }
}
