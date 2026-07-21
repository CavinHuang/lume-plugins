import esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

const target = process.argv.includes("--target=mcp") ? "mcp" : "obsidian";

if (target === "obsidian") {
  await esbuild.build({
    entryPoints: ["src/obsidian-app/main.ts"],
    bundle: true,
    outfile: "dist/main.js",
    format: "cjs",
    platform: "node",
    target: "es2022",
    external: ["obsidian", "electron"],
    logLevel: "info",
  });
  await mkdir("dist/obsidian-plugin", { recursive: true });
  await Promise.all([
    copyFile("dist/main.js", "dist/obsidian-plugin/main.js"),
    copyFile("src/obsidian-app/manifest.json", "dist/obsidian-plugin/manifest.json"),
  ]);
} else {
  await esbuild.build({
    entryPoints: ["src/mcp/server.ts"],
    bundle: true,
    outfile: "dist/mcp.js",
    format: "esm",
    platform: "node",
    target: "es2022",
    logLevel: "info",
  });
}
