import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const scripts=["chrome-is-running.mjs","check-extension-installed.mjs","check-native-host-manifest.mjs"];
for(const script of scripts){const r=spawnSync(process.execPath,[fileURLToPath(new URL(script,import.meta.url))],{encoding:"utf8"});console.log(`\n## ${script}\n${r.stdout}${r.stderr}`);}
