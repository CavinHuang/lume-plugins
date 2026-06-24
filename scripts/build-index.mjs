// 生成或校验 .lume-plugin/marketplace.json。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest } from "./lib/build-manifest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKET_PATH = join(ROOT, ".lume-plugin", "marketplace.json");

const MARKET_NAME = process.env.MARKET_NAME ?? "Lume Plugins";
const MARKET_DESC = process.env.MARKET_DESC ?? "Lume 官方精选插件与技能集合";
const OWNER_NAME = process.env.MARKET_OWNER ?? "CavinHuang";

const { manifest, violations } = buildManifest({
  pluginsRoot: join(ROOT, "plugins"),
  skillsRoot: join(ROOT, "skills"),
  marketName: MARKET_NAME,
  marketDescription: MARKET_DESC,
  owner: { name: OWNER_NAME },
});

if (violations.length > 0) {
  console.error("❌ Marketplace validation failed:\n  - " + violations.join("\n  - "));
  process.exit(1);
}

const serialized = JSON.stringify(manifest, null, 2) + "\n";

if (process.argv.includes("--check")) {
  if (!existsSync(MARKET_PATH)) {
    console.error(`❌ ${MARKET_PATH} 不存在。运行:npm run build:index`);
    process.exit(1);
  }
  if (readFileSync(MARKET_PATH, "utf8") !== serialized) {
    console.error(`❌ ${MARKET_PATH} 与目录不一致。运行:npm run build:index`);
    process.exit(1);
  }
  console.log("✓ marketplace.json in sync");
} else {
  mkdirSync(dirname(MARKET_PATH), { recursive: true });
  writeFileSync(MARKET_PATH, serialized, "utf8");
  console.log(`✓ wrote ${MARKET_PATH} (${manifest.plugins.length} plugins, ${manifest.skills.length} skills)`);
}
