import esbuild from "esbuild";

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
} else {
  await esbuild.build({
    entryPoints: ["src/mcp/server.ts"],
    bundle: true,
    outfile: "dist/mcp.js",
    format: "esm",
    platform: "node",
    target: "es2022",
    external: ["@modelcontextprotocol/sdk"],
    logLevel: "info",
  });
}
