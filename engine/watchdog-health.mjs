import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

// The LaunchAgent runs every six hours. An assertion expires after two missed
// runs, so passive displays never present an abandoned watchdog as healthy.
export const STATUS_VALID_FOR_MS = 12 * 60 * 60 * 1000;

export function createHealthStatus(problems = [], checkedAt = new Date(), validForMs = STATUS_VALID_FOR_MS) {
  const checkedAtMs = checkedAt.getTime();
  return {
    checkedAt: checkedAt.toISOString(),
    expiresAt: new Date(checkedAtMs + validForMs).toISOString(),
    healthy: problems.length === 0,
    problems: problems.map(String),
  };
}

export function writeHealthStatus(path, problems = [], checkedAt = new Date(), validForMs) {
  const status = createHealthStatus(problems, checkedAt, validForMs);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(status, null, 2) + "\n");
  renameSync(temporaryPath, path);
  return status;
}

export function readHealthStatus(path) {
  if (!existsSync(path)) return null;
  try {
    const status = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof status.checkedAt !== "string" ||
      !Number.isFinite(new Date(status.checkedAt).getTime()) ||
      typeof status.expiresAt !== "string" ||
      !Number.isFinite(new Date(status.expiresAt).getTime()) ||
      new Date(status.expiresAt).getTime() <= new Date(status.checkedAt).getTime() ||
      typeof status.healthy !== "boolean" ||
      !Array.isArray(status.problems) ||
      !status.problems.every((problem) => typeof problem === "string") ||
      status.healthy !== (status.problems.length === 0)
    ) {
      return null;
    }
    return status;
  } catch {
    return null;
  }
}
