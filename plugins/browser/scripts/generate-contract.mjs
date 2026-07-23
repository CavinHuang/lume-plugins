import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const source = resolve(directory, "../../../shared/browser-contract.json");
const target = resolve(directory, "../src/browser-contract.json");
writeFileSync(target, readFileSync(source));

const chromeDist = resolve(directory, "../../lume-chrome/dist");
const output = resolve(directory, "../dist");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(resolve(chromeDist, "client"), resolve(output, "client"), { recursive: true });
cpSync(resolve(chromeDist, "shared"), resolve(output, "shared"), { recursive: true });
writeFileSync(resolve(output, "browser-client.js"), [
  "// Generated from the canonical lume-chrome BrowserClient build.",
  'export * from "./client/BrowserClient.js";',
  'export * from "./client/setupBrowserRuntime.js";',
  "",
].join("\n"));
