import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function readMirrorConfig(env = process.env) {
  const generation = String(env.LUME_MARKET_GENERATION ?? readGenerationFile(env.LUME_MARKET_GENERATION_FILE)).trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(generation)) {
    throw new Error("LUME_MARKET_GENERATION must be the deployed 40-character Git commit SHA");
  }
  return {
    host: String(env.HOST ?? "0.0.0.0"),
    port: readPort(env.PORT, 8787),
    sourceRoot: resolve(env.LUME_MARKET_SOURCE_ROOT ?? "/market"),
    dataDir: resolve(env.LUME_MARKET_DATA_DIR ?? "/data"),
    generation,
    owner: String(env.LUME_MARKET_REPOSITORY_OWNER ?? "CavinHuang"),
    repo: String(env.LUME_MARKET_REPOSITORY_NAME ?? "lume-plugins"),
    ref: String(env.LUME_MARKET_REPOSITORY_REF ?? "main"),
    repositoryUrl: String(env.LUME_MARKET_REPOSITORY_URL ?? "https://github.com/CavinHuang/lume-plugins"),
  };
}

function readGenerationFile(path) {
  if (!path) return "";
  try { return readFileSync(path, "utf8"); }
  catch { return ""; }
}

function readPort(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}
