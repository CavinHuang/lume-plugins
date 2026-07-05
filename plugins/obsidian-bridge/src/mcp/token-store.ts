import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface TokenStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

export function resolveDefaultTokenStorePath(): string {
  return process.env.OBSIDIAN_BRIDGE_TOKEN_STORE
    ?? join(homedir(), ".lume", "plugin-data", "obsidian-bridge", "token.json");
}

export function createFileTokenStore(path = resolveDefaultTokenStorePath()): TokenStore {
  return {
    async read() {
      try {
        const raw = await readFile(path, "utf-8");
        const parsed = JSON.parse(raw) as { token?: unknown };
        return typeof parsed.token === "string" && parsed.token.trim() ? parsed.token : null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        return null;
      }
    },
    async write(token) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, `${JSON.stringify({ token }, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
      await rename(tmp, path);
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
}
