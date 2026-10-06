import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
export async function writeVerificationReport(input: {
  runId: string; startedAt: string; status: "running" | "passed" | "failed";
  checks: string[]; completedAt?: string; failedStage?: string;
}) {
  const directory = path.resolve(".local");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `verification-report-${input.runId}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ ...input, checkCount: input.checks.length }, null, 2), { mode: 0o600 });
    await rename(temporary, path.join(directory, "registration-verification-report.json"));
  } finally { await unlink(temporary).catch(() => {}); }
}
