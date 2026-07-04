import { PROTOCOL_VERSION, ERROR_CODES, type ErrorCode } from "../shared/protocol.ts";
import { CONFIRMED_HEADER } from "../obsidian-app/trust-policy.ts";

export class BridgeError extends Error {
  code: ErrorCode;
  status: number;
  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface ObsidianClient {
  health(): Promise<{ ok: boolean; protocol: number; appVersion: string; vaultName: string }>;
  pair(code: string): Promise<{ token: string; vaultName: string }>;
  readNote(path: string): Promise<{ path: string; content: string }>;
  upsertNote(path: string, content: string, opts?: { confirmed?: boolean }): Promise<void>;
  patchNote(
    path: string,
    patch: { appendBody?: string; frontmatter?: Record<string, unknown> },
  ): Promise<void>;
  deleteNote(path: string): Promise<void>;
  search(
    q: string,
    opts?: { type?: string; limit?: number },
  ): Promise<{ path: string; snippet: string; score: number }[]>;
  metadata(path: string): Promise<{
    tags: string[];
    frontmatter: Record<string, unknown>;
    mtime: number;
    ctime: number;
  }>;
  backlinks(path: string): Promise<{ fromPath: string; occurrences: number }[]>;
  readPalace(room: string): Promise<{
    trigger: string;
    mustRead: string[];
    conditionalRead: string[];
    outputLocation: string;
    pitfalls: string[];
  }>;
  listNotes(prefix: string): Promise<string[]>;
  diagnostics(): Promise<{
    brokenLinks: { from: string; link: string }[];
    orphans: string[];
    rawUndigested: string[];
  }>;
}

export interface ClientDeps {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export function createObsidianClient(deps: ClientDeps): ObsidianClient {
  const f = deps.fetchImpl ?? fetch;
  async function req(
    method: string,
    path: string,
    opts: {
      query?: Record<string, string>;
      body?: unknown;
      auth?: boolean;
      extraHeaders?: Record<string, string>;
    } = {},
  ): Promise<any> {
    const url = new URL(deps.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = {
      "x-protocol-version": String(PROTOCOL_VERSION),
      ...opts.extraHeaders,
    };
    if (opts.auth !== false) {
      const t = await deps.getToken();
      if (t) headers.authorization = `Bearer ${t}`;
    }
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    let res: Response;
    try {
      res = await f(url.toString(), init);
    } catch {
      throw new BridgeError(ERROR_CODES.bridge_unreachable, "Obsidian bridge unreachable", 0);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (json as { error?: { code?: ErrorCode } })?.error?.code ?? ERROR_CODES.not_found;
      throw new BridgeError(
        code,
        (json as { error?: { message?: string } })?.error?.message ?? res.statusText,
        res.status,
      );
    }
    return json;
  }

  return {
    health: () => req("GET", "/health", { auth: false }),
    pair: (code) => req("POST", "/pair", { auth: false, body: { code } }),
    readNote: (path) => req("GET", "/notes", { query: { path } }),
    upsertNote: async (path, content, o) => {
      try {
        await req("POST", "/notes", { body: { path, content } });
      } catch (e) {
        if (
          e instanceof BridgeError &&
          e.code === ERROR_CODES.needs_confirmation &&
          o?.confirmed
        ) {
          await req("POST", "/notes", {
            body: { path, content },
            extraHeaders: { [CONFIRMED_HEADER]: "true" },
          });
          return;
        }
        throw e;
      }
    },
    patchNote: (path, patch) => req("PATCH", "/notes", { body: { path, patch } }),
    deleteNote: (path) => req("DELETE", "/notes", { query: { path } }),
    search: async (q, o) =>
      (
        await req("GET", "/search", {
          query: {
            q,
            ...(o?.type ? { type: o.type } : {}),
            ...(o?.limit ? { limit: String(o.limit) } : {}),
          },
        })
      ).hits,
    metadata: (path) => req("GET", "/metadata", { query: { path } }),
    backlinks: async (path) => (await req("GET", "/backlinks", { query: { path } })).backlinks,
    readPalace: (room) => req("GET", `/palace/${encodeURIComponent(room)}`),
    listNotes: async (prefix) => (await req("GET", "/notes", { query: { list: prefix } })).paths,
    diagnostics: () => req("GET", "/diagnostics"),
  };
}
