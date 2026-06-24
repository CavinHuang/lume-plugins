// 发现 plugins/ 与 skills/,校验,组装 MarketplaceManifest(纯读,不写盘)。
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { validatePluginName, validateSemver, validatePluginPath } from "./manifest-rules.mjs";
import { parseSkillFrontmatter } from "./skill-frontmatter.mjs";
import { auditPermissions } from "./audit-permissions.mjs";

const PLUGIN_MANIFEST = "lume-plugin.json";

function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith(".") && statSync(join(dir, n)).isDirectory())
    .sort();
}

function discoverPlugins(pluginsRoot) {
  const entries = [];
  const violations = [];
  for (const dirName of listDirs(pluginsRoot)) {
    const dir = join(pluginsRoot, dirName);
    const manifestPath = join(dir, PLUGIN_MANIFEST);
    if (!existsSync(manifestPath)) { violations.push(`plugins/${dirName}: missing ${PLUGIN_MANIFEST}`); continue; }
    let manifest;
    try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
    catch (e) { violations.push(`plugins/${dirName}: ${PLUGIN_MANIFEST} is not valid JSON (${e.message})`); continue; }
    if (manifest.schema !== "lume-plugin/v1") { violations.push(`plugins/${dirName}: schema must be "lume-plugin/v1"`); continue; }
    try { validatePluginName(manifest.name); validateSemver(manifest.version); }
    catch (e) { violations.push(`plugins/${dirName}: ${e.message}`); continue; }
    if (manifest.name !== dirName) { violations.push(`plugins/${dirName}: directory name must equal manifest name "${manifest.name}"`); continue; }
    for (const required of ["LICENSE", "README.md"]) {
      if (!existsSync(join(dir, required))) violations.push(`plugins/${dirName}: missing required file ${required}`);
    }
    const readme = existsSync(join(dir, "README.md")) ? readFileSync(join(dir, "README.md"), "utf8") : "";
    violations.push(...auditPermissions(manifest, readme));
    // 声明的 skills/hooks/mcp 路径必须相对
    const pathFields = [["skills", manifest.skills], ["hooks", manifest.hooks], ["mcpServers", manifest.mcpServers]];
    for (const [field, value] of pathFields) {
      const arr = Array.isArray(value) ? value : (typeof value === "string" ? [value] : []);
      for (const v of arr) {
        try { validatePluginPath(v, `${field} path`); }
        catch (e) { violations.push(`plugins/${dirName}: ${e.message}`); }
      }
    }
    entries.push({
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      source: `./plugins/${dirName}`,
      author: typeof manifest.author === "string" ? { name: manifest.author } : manifest.author,
    });
  }
  return { entries, violations };
}

function discoverSkills(skillsRoot) {
  const entries = [];
  const violations = [];
  for (const dirName of listDirs(skillsRoot)) {
    const dir = join(skillsRoot, dirName);
    const skillMd = join(dir, "SKILL.md");
    if (!existsSync(skillMd)) { violations.push(`skills/${dirName}: missing SKILL.md`); continue; }
    const fm = parseSkillFrontmatter(readFileSync(skillMd, "utf8"));
    const name = fm.name || dirName;
    if (name !== dirName) { violations.push(`skills/${dirName}: SKILL.md frontmatter name "${name}" must equal directory name`); continue; }
    entries.push({ name, description: fm.description, source: `./skills/${dirName}` });
  }
  return { entries, violations };
}

export function buildManifest({ pluginsRoot, skillsRoot, marketName, marketDescription, owner }) {
  const plugins = discoverPlugins(pluginsRoot);
  const skills = discoverSkills(skillsRoot);
  const violations = [...plugins.violations, ...skills.violations];
  if (plugins.entries.length === 0 && skills.entries.length === 0) {
    violations.push("marketplace.json must contain at least one plugin or skill");
  }
  const manifest = {
    name: marketName,
    description: marketDescription,
    owner,
    plugins: plugins.entries.sort((a, b) => a.name.localeCompare(b.name)),
    skills: skills.entries.sort((a, b) => a.name.localeCompare(b.name)),
  };
  // JSON.stringify 会自动丢弃 undefined 字段(author/description/owner)。
  return { manifest, violations };
}
