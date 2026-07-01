import fs from "node:fs";
import path from "node:path";

const distRoot = path.resolve("dist");

function listJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJsFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(fullPath);
  }
  return files;
}

function needsExtension(specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return false;
  return !/\.(?:js|json|css|svg|png|jpg|jpeg|webp|wasm)$/i.test(specifier);
}

if (fs.existsSync(distRoot)) {
  for (const file of listJsFiles(distRoot)) {
    const source = fs.readFileSync(file, "utf8");
    const next = source.replace(
      /(from\s*["'])(\.{1,2}\/[^"']+)(["'])/g,
      (_match, prefix, specifier, suffix) => `${prefix}${needsExtension(specifier) ? `${specifier}.js` : specifier}${suffix}`,
    );
    if (next !== source) fs.writeFileSync(file, next);
  }
}
