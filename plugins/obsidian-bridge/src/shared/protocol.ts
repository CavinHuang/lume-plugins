// 两端共享的协议契约。单一事实源——改这里,两端都变。
export const PROTOCOL_VERSION = 1 as const;

export const ERROR_CODES = {
  bridge_unreachable: "bridge_unreachable",
  token_invalid: "token_invalid",
  vault_mismatch: "vault_mismatch",
  protocol_mismatch: "protocol_mismatch",
  raw_readonly: "raw_readonly",
  needs_confirmation: "needs_confirmation",
  not_found: "not_found",
  merge_conflict: "merge_conflict",
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

export const ENDPOINTS = {
  health: "/health",
  pair: "/pair",
  notes: "/notes",
  search: "/search",
  metadata: "/metadata",
  backlinks: "/backlinks",
  palace: "/palace", // 实际路径 /palace/:room
  graph: "/graph", // 实际路径 /graph/:op
  events: "/events",
} as const;

export type TrustLevel = "raw_readonly" | "free_write" | "needs_confirmation" | "free";

// 房间卡五段(Memory Palace)
export interface RoomCard {
  trigger: string;
  mustRead: string[]; // 按顺序
  conditionalRead: string[];
  outputLocation: string;
  pitfalls: string[];
}

// 通用错误体
export interface ApiError {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface NoteRef {
  path: string;
}

// 搜索命中结果的权威结构(单一事实源)。两端 search 实现应与此保持一致。
// 当前各实现(vault-service / obsidian-client)仍用内联字面量构造,后续可改为 import 本类型复用。
// mtime 为 P0 修复新增的真实文件修改时间(来自 file.stat),防止假时间戳。
export interface SearchHit {
  path: string;
  snippet: string;
  score: number;
  mtime: number;
}

export interface Backlink {
  fromPath: string;
  occurrences: number;
}
