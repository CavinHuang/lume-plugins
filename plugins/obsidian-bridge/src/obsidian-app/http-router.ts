import {
  PROTOCOL_VERSION,
  ERROR_CODES,
  type ApiError,
  type ErrorCode,
} from "../shared/protocol.ts";
import { classifyTrust, CONFIRMED_HEADER, isWrite } from "./trust-policy.ts";
import { parseRoomCard } from "./palace.ts";
import type { PairingStore } from "./pairing-store.ts";
import type { Adjacency, StructureReport } from "./graph-engine.ts";

export interface VaultService {
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  write(path: string, content: string): Promise<void>;
  patch(
    path: string,
    patch: { appendBody?: string; frontmatter?: Record<string, unknown> },
  ): Promise<void>;
  delete(path: string): Promise<void>;
  search(
    q: string,
    opts: { type?: string; limit?: number },
  ): Promise<{ path: string; snippet: string; score: number; mtime: number }[]>;
  metadata(path: string): Promise<{
    tags: string[];
    frontmatter: Record<string, unknown>;
    mtime: number;
    ctime: number;
  }>;
  backlinks(path: string): Promise<{ fromPath: string; occurrences: number }[]>;
  listNotes(prefix: string): Promise<string[]>;
  diagnostics(): Promise<{
    brokenLinks: { from: string; link: string }[];
    orphans: string[];
    rawUndigested: string[];
  }>;
  // 图谱适配层(Task 6):基于 metadataCache.resolvedLinks 构建邻接表 + 邻居/最短路径查询
  buildAdjacencies(): { fwd: Adjacency; back: Adjacency; both: Adjacency };
  graphNeighbors(
    path: string,
    depth: number,
    direction: "fwd" | "back" | "both",
  ): { path: string; depth: number; via: string }[];
  graphPath(from: string, to: string): string[];
  // 结构分析(Task 9):hub(度数 top-N)、orphans(零度)、bridges(Tarjan 桥边)。
  // 同步:与 graphNeighbors/graphPath 一致,基于内存邻接表。
  graphStructure(top?: number): StructureReport;
}

export interface RouterRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown; // 已解析对象或字符串
  query?: Record<string, string>;
}

export interface RouterResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

function err(code: ErrorCode, message: string, status: number, details?: unknown): RouterResponse {
  const e: ApiError = { error: { code, message, ...(details ? { details } : {}) } };
  return { status, body: e };
}

export interface RouterDeps {
  vault: VaultService;
  pairing: PairingStore;
  vaultName: string;
  appVersion: string;
  getRoomMarkdown: (room: string) => Promise<string>;
}

export function createRouter(deps: RouterDeps) {
  async function authed(req: RouterRequest): Promise<string | null> {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    return deps.pairing.isActive(token) ? token : null;
  }

  return async function handle(req: RouterRequest): Promise<RouterResponse> {
    // 协议版本协商(非 health 端点)
    if (req.path !== "/health") {
      const v = Number(req.headers["x-protocol-version"] ?? PROTOCOL_VERSION);
      const major = Math.floor(v);
      if (major !== PROTOCOL_VERSION) {
        return err(ERROR_CODES.protocol_mismatch, `protocol v${major} not supported`, 426);
      }
    }

    // /health
    if (req.method === "GET" && req.path === "/health") {
      return {
        status: 200,
        body: { ok: true, protocol: PROTOCOL_VERSION, appVersion: deps.appVersion, vaultName: deps.vaultName },
      };
    }

    // /pair
    if (req.method === "POST" && req.path === "/pair") {
      const code = (req.body as { code?: string })?.code ?? "";
      const token = deps.pairing.consumeCode(code);
      if (!token) return err(ERROR_CODES.token_invalid, "invalid or expired pairing code", 401);
      return { status: 200, body: { token, vaultName: deps.vaultName } };
    }

    // 其余均需鉴权
    const token = await authed(req);
    if (!token) return err(ERROR_CODES.token_invalid, "missing or invalid token", 401);

    // 写入信任分级拦截
    if (isWrite(req.method) && req.path === "/notes") {
      const path = String((req.body as { path?: string })?.path ?? "");
      const level = classifyTrust(path);
      if (level === "raw_readonly") return err(ERROR_CODES.raw_readonly, "raw/ is readonly", 403);
      if (level === "needs_confirmation" && req.headers[CONFIRMED_HEADER] !== "true") {
        return err(
          ERROR_CODES.needs_confirmation,
          `writing to ${path} requires confirmation; retry the same request with header X-Confirmed: true (or MCP param confirmed=true)`,
          409,
          { path, method: req.method },
        );
      }
    }

    // /notes
    if (req.path === "/notes") {
      const q = req.query ?? {};
      if (req.method === "GET") {
        if (q.list !== undefined) {
          return { status: 200, body: { paths: await deps.vault.listNotes(q.list) } };
        }
        if (!(await deps.vault.exists(q.path))) return err(ERROR_CODES.not_found, "not found", 404);
        return { status: 200, body: { path: q.path, content: await deps.vault.read(q.path) } };
      }
      const b = req.body as { path: string; content: string };
      if (req.method === "POST") {
        await deps.vault.write(b.path, b.content);
        return { status: 201, body: { ok: true, path: b.path } };
      }
      if (req.method === "PATCH") {
        await deps.vault.patch(
          b.path,
          (req.body as unknown as {
            patch: { appendBody?: string; frontmatter?: Record<string, unknown> };
          }).patch,
        );
        return { status: 200, body: { ok: true } };
      }
      if (req.method === "DELETE") {
        await deps.vault.delete(q.path);
        return { status: 200, body: { ok: true } };
      }
    }

    // /search
    if (req.method === "GET" && req.path === "/search") {
      const q = req.query ?? {};
      return {
        status: 200,
        body: {
          hits: await deps.vault.search(q.q ?? "", {
            type: q.type,
            limit: Number(q.limit ?? 50),
          }),
        },
      };
    }
    // /metadata
    if (req.method === "GET" && req.path === "/metadata") {
      return { status: 200, body: await deps.vault.metadata(req.query?.path ?? "") };
    }
    // /backlinks
    if (req.method === "GET" && req.path === "/backlinks") {
      return { status: 200, body: { backlinks: await deps.vault.backlinks(req.query?.path ?? "") } };
    }
    // /diagnostics
    if (req.method === "GET" && req.path === "/diagnostics") {
      return { status: 200, body: await deps.vault.diagnostics() };
    }
    // /palace/:room
    if (req.method === "GET" && req.path.startsWith("/palace/")) {
      const room = req.path.slice("/palace/".length);
      const md = await deps.getRoomMarkdown(room);
      return { status: 200, body: parseRoomCard(md) };
    }
    // /graph/neighbors(N 跳邻居;depth 钳制 1..3,direction 规范化 fwd|back|both)
    if (req.method === "GET" && req.path === "/graph/neighbors") {
      const q = req.query ?? {};
      const depth = Math.min(Math.max(Number(q.depth ?? 1) || 1, 1), 3); // clamp 1..3
      const direction = (q.direction === "fwd" || q.direction === "back" ? q.direction : "both") as
        | "fwd"
        | "back"
        | "both";
      const nodes = await deps.vault.graphNeighbors(q.path ?? "", depth, direction);
      return { status: 200, body: { nodes } };
    }
    // /graph/path(最短路径 + hops)
    if (req.method === "GET" && req.path === "/graph/path") {
      const q = req.query ?? {};
      const path = await deps.vault.graphPath(q.from ?? "", q.to ?? "");
      return { status: 200, body: { path, hops: Math.max(0, path.length - 1) } };
    }
    // /graph/structure(hub/孤岛/桥;top 钳制 1..100,默认 10)
    if (req.method === "GET" && req.path === "/graph/structure") {
      const q = req.query ?? {};
      const top = q.top ? Math.min(Math.max(Number(q.top) || 10, 1), 100) : 10;
      return { status: 200, body: deps.vault.graphStructure(top) };
    }
    // /events(SSE 占位:Phase 1 返回 501,Phase 2 实现推送)
    if (req.method === "GET" && req.path === "/events") {
      return err(ERROR_CODES.not_found, "events stream not implemented in Phase 1", 501);
    }

    return err(ERROR_CODES.not_found, `no route for ${req.method} ${req.path}`, 404);
  };
}
