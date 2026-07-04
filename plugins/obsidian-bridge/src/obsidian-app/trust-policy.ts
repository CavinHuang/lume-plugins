import type { TrustLevel } from "../shared/protocol.ts";

export const CONFIRMED_HEADER = "x-confirmed";

// 写入需确认的路径前缀 + 根级文件
const NEEDS_CONFIRM_PREFIXES = ["people/", "projects/", "wiki/", "decisions/", "daily/", "palace/"];
const NEEDS_CONFIRM_FILES = ["profile.md", "vault.md", "style.md", "memory_policy.md"];

export function classifyTrust(path: string): TrustLevel {
  const p = path.replace(/^\//, "").toLowerCase();
  if (p === "raw/" || p.startsWith("raw/")) return "raw_readonly";
  if (p === "sources/" || p.startsWith("sources/")) return "free_write";
  if (p === "memory/inbox/" || p.startsWith("memory/inbox/")) return "free_write";
  if (p === "memory/feedback/" || p.startsWith("memory/feedback/")) return "free_write";
  if (NEEDS_CONFIRM_FILES.includes(p)) return "needs_confirmation";
  if (NEEDS_CONFIRM_PREFIXES.some((pre) => p.startsWith(pre))) return "needs_confirmation";
  return "free";
}

export function isWrite(method: string): boolean {
  return ["POST", "PATCH", "DELETE"].includes(method.toUpperCase());
}
