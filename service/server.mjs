import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { readMirrorConfig } from "./config.mjs";
import { buildSnapshot } from "./snapshot.mjs";

export async function startMirrorServer(config = readMirrorConfig()) {
  const snapshot = await buildSnapshot(config);
  const root = join(config.dataDir, "generations", snapshot.generation);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://mirror.local");
      if (request.method === "GET" && url.pathname === "/healthz") {
        return sendJson(response, 200, { ok: true, generation: snapshot.generation, generatedAt: snapshot.generatedAt }, { "cache-control": "no-store" });
      }
      if (request.method === "GET" && url.pathname === "/v1/catalog") {
        const etag = `\"${snapshot.generation}\"`;
        if (request.headers["if-none-match"] === etag) {
          response.writeHead(304, catalogHeaders(etag));
          return response.end();
        }
        return sendJson(response, 200, snapshot, catalogHeaders(etag));
      }
      const archive = /^\/v1\/snapshots\/([a-f0-9]{40})\/archive\.tar\.gz$/i.exec(url.pathname);
      if (request.method === "GET" && archive?.[1]?.toLowerCase() === snapshot.generation) {
        return sendFile(response, join(root, "archive.tar.gz"), "application/gzip");
      }
      const raw = /^\/v1\/snapshots\/([a-f0-9]{40})\/raw\/(.+)$/i.exec(url.pathname);
      if (request.method === "GET" && raw?.[1]?.toLowerCase() === snapshot.generation) {
        const file = await resolveContainedFile(join(root, "repo"), decodeURIComponent(raw[2]));
        return file ? sendFile(response, file, contentType(file)) : sendJson(response, 404, { error: "not found" });
      }
      return sendJson(response, 404, { error: "not found" });
    } catch (error) {
      return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  return { server, snapshot };
}

function catalogHeaders(etag) {
  return {
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
    etag,
    "x-content-type-options": "nosniff",
  };
}

async function resolveContainedFile(root, relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) return undefined;
  try {
    const realRoot = await realpath(root);
    const candidate = await realpath(join(realRoot, normalized));
    const rel = relative(realRoot, candidate);
    if (rel.startsWith("..") || isAbsolute(rel) || !(await stat(candidate)).isFile()) return undefined;
    let cursor = realRoot;
    for (const segment of rel.split(/[\\/]+/).filter(Boolean)) {
      cursor = join(cursor, segment);
      if ((await lstat(cursor)).isSymbolicLink()) return undefined;
    }
    return candidate;
  } catch {
    return undefined;
  }
}

async function sendFile(response, path, mediaType) {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return sendJson(response, 404, { error: "not found" });
  response.writeHead(200, {
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=31536000, immutable",
    "content-length": String(info.size),
    "content-type": mediaType,
    "x-content-type-options": "nosniff",
  });
  await pipeline(createReadStream(path), response);
}

function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-length": String(Buffer.byteLength(body)),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(body);
}

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".json": return "application/json; charset=utf-8";
    case ".md": return "text/markdown; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".zip": return "application/zip";
    default: return "application/octet-stream";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { snapshot } = await startMirrorServer();
  console.log(`Lume plugin mirror ${snapshot.generation} listening on ${process.env.HOST ?? "0.0.0.0"}:${process.env.PORT ?? "8787"}`);
}
