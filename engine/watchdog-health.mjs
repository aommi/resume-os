import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export function createHealthStatus(problems = [], checkedAt = new Date()) {
  return {
    checkedAt: checkedAt.toISOString(),
    healthy: problems.length === 0,
    problems: problems.map(String),
  };
}

export function writeHealthStatus(path, problems = [], checkedAt = new Date()) {
  const status = createHealthStatus(problems, checkedAt);
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
