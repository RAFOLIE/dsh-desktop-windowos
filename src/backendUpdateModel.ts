import { compare, valid } from "semver";

export type Channel = "latest" | "next" | "alpha";
export type Relation = "newer" | "equal" | "ahead" | "unknown";
export function versionRelation(current?: string | null, target?: string | null): Relation {
  if (!current || !target || !valid(current) || !valid(target)) return "unknown";
  const order = compare(target, current);
  return order > 0 ? "newer" : order < 0 ? "ahead" : "equal";
}
export type BackendSource = { kind: string; path: string | null; version: string | null; managed: boolean; pid: number | null; prefix: string | null };
export type BackendJob = { id: string; phase: "checking" | "installing" | "restarting" | "verifying" | "succeeded" | "failed"; target: string; error: string | null; failedPhase?: string | null; installationStarted?: boolean; elapsedSeconds?: number; budgetSeconds?: number | null };
export function jobBusy(job: BackendJob | null): boolean {
  return job !== null && job.phase !== "succeeded" && job.phase !== "failed";
}
export function manualCommand(source: BackendSource | null, version: string): string | null {
  if (!valid(version)) return null;
  if (source?.kind === "npx") return `npx @deepseek-ai/dsh@${version} web`;
  // Unknown/custom/local sources need their own package manager and working directory.
  if ((source?.kind === "global" || source?.kind === "external") && source.prefix) {
    return `npm install -g --prefix '${source.prefix.replace(/'/g, "''")}' @deepseek-ai/dsh@${version} --registry=https://registry.npmjs.org`;
  }
  return null;
}

export function updateErrorKind(error: string): "reset" | "timeout" | "missing" | "network" | "other" {
  if (/\b(E404|ETARGET)\b/.test(error)) return "missing";
  if (/\bECONNRESET\b/.test(error)) return "reset";
  if (/\b(TIMEOUT|ETIMEDOUT|ESOCKETTIMEDOUT)\b/.test(error)) return "timeout";
  if (/\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED)\b/.test(error)) return "network";
  return "other";
}

// Exact versions covered by the live backend compatibility matrix.
export const verifiedBackendVersions = ["0.1.6-alpha.2", "0.1.7-alpha.2"] as const;
export function needsSettingsMigration(current?: string | null, target?: string | null): boolean {
  if (!current || !target || !valid(current) || !valid(target)) return false;
  return compare(current, "0.1.7-alpha.1") < 0 && compare(target, "0.1.7-alpha.1") >= 0;
}
