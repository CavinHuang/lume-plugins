import http from "node:http";
import { createRouter, type RouterRequest, type VaultService } from "./http-router.ts";
import type { PairingStore } from "./pairing-store.ts";

export interface ServerHandle {
  close(): void;
  port: number;
}

export function startServer(opts: {
  port: number;
  vault: VaultService;
  pairing: PairingStore;
  vaultName: string;
  appVersion: string;
  getRoomMarkdown: (room: string) => Promise<string>;
}): ServerHandle {
  const handle = createRouter({
    vault: opts.vault,
    pairing: opts.pairing,
    vaultName: opts.vaultName,
    appVersion: opts.appVersion,
    getRoomMarkdown: opts.getRoomMarkdown,
  });

  async function readBody(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text) return "";
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        query[k] = v;
      });
      const rreq: RouterRequest = {
        method: req.method ?? "GET",
        path: url.pathname,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [
            k.toLowerCase(),
            Array.isArray(v) ? v[0] : v ?? "",
          ]),
        ),
        body: await readBody(req),
        query,
      };
      const rres = await handle(rreq);
      res.writeHead(rres.status, {
        "content-type": "application/json",
        ...(rres.headers ?? {}),
      });
      res.end(JSON.stringify(rres.body));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: String(e) } }));
    }
  });
  server.listen(opts.port, "127.0.0.1");
  return { close: () => server.close(), port: opts.port };
}
