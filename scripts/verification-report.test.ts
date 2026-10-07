import { expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeVerificationReport } from "./verification-report";

it("replaces previous success immediately, then records a safe failed current run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bmadecomm-report-test-"));
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(directory);
  try {
    const report = path.join(directory, ".local", "registration-verification-report.json");
    await writeVerificationReport({ runId: "prior", startedAt: "before", status: "passed", completedAt: "before-end", checks: ["prior check"] });
    await writeVerificationReport({ runId: "current", startedAt: "now", status: "running", checks: [] });
    expect(JSON.parse(await readFile(report, "utf8"))).toEqual({ runId: "current", startedAt: "now", status: "running", checks: [], checkCount: 0 });
    await writeVerificationReport({ runId: "current", startedAt: "now", status: "failed", completedAt: "end", failedStage: "local configuration and PostgreSQL/server availability", checks: [] });
    const final = JSON.parse(await readFile(report, "utf8"));
    expect(final.status).toBe("failed"); expect(final.runId).toBe("current"); expect(final.completedAt).toBe("end"); expect(final.failedStage).toBe("local configuration and PostgreSQL/server availability");
  } finally {
    cwd.mockRestore();
    const target = path.resolve(directory);
    if (!target.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(target).startsWith("bmadecomm-report-test-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true });
  }
});
