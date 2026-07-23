import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const contract = JSON.parse(readFileSync(resolve(root, "shared/browser-contract.json"), "utf8"));
const output = `// Generated from shared/browser-contract.json.\nexport const BROWSER_CONTRACT = ${JSON.stringify({ protocolVersion: contract.protocolVersion, minSupported: contract.minSupported, maxSupported: contract.maxSupported, externalProtocolVersion: contract.externalProtocolVersion, externalMinSupported: contract.externalMinSupported, externalMaxSupported: contract.externalMaxSupported }, null, 2)} as const\n`;
writeFileSync(resolve(import.meta.dirname, "../src/shared/browser-contract.generated.ts"), output);
