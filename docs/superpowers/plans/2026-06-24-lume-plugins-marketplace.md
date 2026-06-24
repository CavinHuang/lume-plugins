# Lume 官方插件市场收录仓库 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 `CavinHuang/lume-plugins` 仓库——一个官方精选、可被 Lume 直接订阅的插件/技能收录 monorepo,含自动生成索引、严格 CI 闸口、Copilot AI 评审接入与完整文档。

**Architecture:** Vendored monorepo(插件代码物理存在于本仓库)。一个零依赖 Node 脚本扫描 `plugins/`+`skills/`、校验清单、生成 `.lume-plugin/marketplace.json`(Lume 写死读取此路径)。CI 在 PR 上跑测试 + 索引一致性 + 权限审计;合入 main 后安全网自动重提交索引。GitHub 原生 Copilot code review + 自定义指令做第一道初筛。

**Tech Stack:** Node.js >= 20(ESM,`.mjs`)· `node:test` 内置测试框架(零依赖)· GitHub Actions · 无第三方 npm 依赖。

## Global Constraints

(摘自 spec `docs/superpowers/specs/2026-06-24-lume-plugins-marketplace-design.md`,每个任务隐含遵守)

- **索引路径写死**:`.lume-plugin/marketplace.json`(Lume `MARKETPLACE_MANIFEST_PATH` 常量)。
- **`source` 必须相对**:仅 `./plugins/<name>` 或 `./skills/<name>`;`assertRelativeMarketplaceSource` 拒绝绝对路径/盘符/URL。
- **目录名 === 清单 `name`**:name 须匹配 `^[a-z0-9_-]{1,64}$`,version 须匹配 `^\d+\.\d+\.\d+`。
- **清单 schema**:`schema: "lume-plugin/v1"`。
- **权限说明强制**:请求 `shell.allow` / 非空 `network.outbound` / 非空 `filesystem.write` 的插件,README 必须含 `## 权限说明` 或 `## Permissions` 标题行,否则 CI 失败。
- **每个插件必备**:`lume-plugin.json` + `README.md` + `LICENSE`。
- **零 npm 依赖**:仅用 Node 内置模块(`node:fs`/`node:path`/`node:test`/`node:assert`)。
- **Commit 规范**:`<emoji> <type>(<scope>): <中文描述>`(gitmoji + 中文,scope 如 `scripts`/`ci`/`docs`/`plugin`)。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `package.json` | `type: module`、scripts(`build:index`/`check:index`/`test`)、engines node>=20,零依赖 |
| `.gitignore` | 忽略 `node_modules/`、OS 文件;**不**忽略 `.lume-plugin/marketplace.json` |
| `scripts/lib/manifest-rules.mjs` | 镜像自 lume 的 3 个校验函数(validatePluginName/Semver/Path) |
| `scripts/lib/skill-frontmatter.mjs` | SKILL.md frontmatter 极简解析(name/description) |
| `scripts/lib/audit-permissions.mjs` | 权限审计:返回需说明的权限 + README 缺标题的违规 |
| `scripts/lib/build-manifest.mjs` | 核心:发现+校验+组装 `MarketplaceManifest` 对象(纯函数,不写盘) |
| `scripts/build-index.mjs` | CLI:`[--check]` 写盘 / 比对索引,违反则非零退出 |
| `scripts/lib/*.test.mjs` | 对应单元测试(`node:test`,tmpdir fixtures) |
| `plugins/example-hello/*` | 种子示例插件(skill + SessionStart hook + mcp 演示,含 `./data/**` 写权限与说明) |
| `.lume-plugin/marketplace.json` | 【生成物】索引,必须提交 |
| `.github/workflows/validate.yml` | PR 闸口:`npm test` + `check:index` |
| `.github/workflows/publish-index.yml` | 合入 main 后安全网重提交 |
| `.github/copilot-instructions.md` | 钉住 Copilot 评审重点 |
| `.github/PULL_REQUEST_TEMPLATE.md` `.github/ISSUE_TEMPLATE/plugin-submission.yml` `.github/CODEOWNERS` | 收录流程模板 |
| `README.md` `CONTRIBUTING.md` `docs/SUBMISSION_GUIDE.md` `docs/REVIEW_CHECKLIST.md` `SECURITY.md` `LICENSE` | 文档 |

---

### Task 1: 工具链基线

**Files:**
- Create: `package.json`
- Create: `.gitignore`

**Interfaces:**
- Produces: `npm test` / `build:index` / `check:index` 脚本入口。本任务**不放测试文件**(第一批真测试在 Task 2);`npm test` 此时会因无测试文件而退出非零,属正常,本任务不运行它。

- [ ] **Step 1: 确认 Node 版本满足 >=20**

Run: `node --version`
Expected: `v20.x.x` 或更高。

- [ ] **Step 2: 写 `package.json`**

```json
{
  "name": "lume-plugins",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Lume 官方精选插件与技能收录市场",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test",
    "build:index": "node scripts/build-index.mjs",
    "check:index": "node scripts/build-index.mjs --check"
  },
  "license": "MIT"
}
```

- [ ] **Step 3: 写 `.gitignore`**

```gitignore
node_modules/
.DS_Store
*.log
```

- [ ] **Step 4: 验证 package.json 合法且脚本就位**

Run: `node -e "const p=require('./package.json'); console.log(p.type, p.scripts.test, p.scripts['build:index'])"`
Expected: `module node --test node scripts/build-index.mjs`

- [ ] **Step 5: 提交**

```bash
git add package.json .gitignore
git commit -m "🔧 chore: 初始化仓库工具链基线"
```

---

### Task 2: 清单校验规则(镜像自 lume)

**Files:**
- Create: `scripts/lib/manifest-rules.mjs`
- Test: `scripts/lib/manifest-rules.test.mjs`

**Interfaces:**
- Produces: `validatePluginName(name)`, `validateSemver(version)`, `validatePluginPath(value, field)`——均 throw on invalid,无返回值。

- [ ] **Step 1: 写失败测试**

`scripts/lib/manifest-rules.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { validatePluginName, validateSemver, validatePluginPath } from "./manifest-rules.mjs";

test("validatePluginName 接受合法名", () => {
  for (const n of ["a", "example-hello", "foo_bar", "plug123", "x".repeat(64)]) {
    validatePluginName(n);
  }
});

test("validatePluginName 拒绝不合规名", () => {
  for (const n of ["Example", "with space", "has.dot", "", "UPPER", "x".repeat(65), "中文"]) {
    assert.throws(() => validatePluginName(n));
  }
});

test("validateSemver 接受 semver 前缀", () => {
  for (const v of ["1.0.0", "0.0.1", "2.13.4-beta"]) validateSemver(v);
});

test("validateSemver 拒绝非 semver", () => {
  for (const v of ["1.0", "v1.0.0", "", "abc"]) assert.throws(() => validateSemver(v));
});

test("validatePluginPath 要求 ./ 前缀", () => {
  validatePluginPath("./skills/", "skills");
  assert.throws(() => validatePluginPath("skills/", "x"));
  assert.throws(() => validatePluginPath("/abs", "x"));
});

test("validatePluginPath 拒绝 ..", () => {
  assert.throws(() => validatePluginPath("./../x", "x"));
  validatePluginPath("./skills/x", "ok"); // 不抛
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm test`
Expected: FAIL,`Cannot find module './manifest-rules.mjs'`。

- [ ] **Step 3: 写实现(镜像自 lume `packages/sdk/src/plugins/manifest.ts`)**

`scripts/lib/manifest-rules.mjs`:
```js
// 镜像自 lume: packages/sdk/src/plugins/manifest.ts
// (validatePluginName / validateSemver / validatePluginPath)
// 同步时在此登记 lume commit hash。
export const MIRRORED_FROM_LUME = "packages/sdk/src/plugins/manifest.ts";

export function validatePluginName(name) {
  if (!/^[a-z0-9_-]{1,64}$/.test(name ?? "")) {
    throw new Error(
      `Invalid plugin name: "${name}". Must be 1-64 ASCII chars: a-z, 0-9, _, -, and must equal its directory name.`,
    );
  }
}

export function validateSemver(version) {
  if (!/^\d+\.\d+\.\d+/.test(version ?? "")) {
    throw new Error(`Invalid version: "${version}". Must be semver (e.g. "1.0.0").`);
  }
}

export function validatePluginPath(value, field) {
  if (!value.startsWith("./")) {
    throw new Error(`Invalid ${field}: path must start with "./"`);
  }
  for (const segment of value.slice(2).split("/")) {
    if (segment === "..") {
      throw new Error(`Invalid ${field}: path must not contain ".."`);
    }
  }
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm test`
Expected: PASS(全部测试,含 sanity 共 8 个)。

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/manifest-rules.mjs scripts/lib/manifest-rules.test.mjs
git commit -m "✨ feat(scripts): 添加插件清单校验规则(镜像自 lume)"
```

---

### Task 3: SKILL.md frontmatter 解析

**Files:**
- Create: `scripts/lib/skill-frontmatter.mjs`
- Test: `scripts/lib/skill-frontmatter.test.mjs`

**Interfaces:**
- Produces: `parseSkillFrontmatter(md)` → 对象,至少含 `name`、`description`(从 `---` YAML 块提取,无块则 `{}`)。

- [ ] **Step 1: 写失败测试**

`scripts/lib/skill-frontmatter.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseSkillFrontmatter } from "./skill-frontmatter.mjs";

test("解析标准 frontmatter", () => {
  const md = "---\nname: hello\ndescription: says hi\n---\n# body";
  assert.deepEqual(parseSkillFrontmatter(md), { name: "hello", description: "says hi" });
});

test("去除引号包裹的值", () => {
  const md = '---\nname: "hi"\ndescription: \'d\'\n---\n';
  assert.deepEqual(parseSkillFrontmatter(md), { name: "hi", description: "d" });
});

test("无 frontmatter 返回空对象", () => {
  assert.deepEqual(parseSkillFrontmatter("# just body"), {});
});

test("忽略无冒号的行", () => {
  const md = "---\nname: hi\nbadline\n---\n";
  assert.deepEqual(parseSkillFrontmatter(md), { name: "hi" });
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm test`
Expected: FAIL,`Cannot find module './skill-frontmatter.mjs'`。

- [ ] **Step 3: 写实现**

`scripts/lib/skill-frontmatter.mjs`:
```js
// 极简 SKILL.md frontmatter 解析(仅 name/description,避免引入 yaml 依赖)。
export function parseSkillFrontmatter(md) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(md));
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key) out[key] = val;
  }
  return out;
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/skill-frontmatter.mjs scripts/lib/skill-frontmatter.test.mjs
git commit -m "✨ feat(scripts): 添加 SKILL.md frontmatter 解析"
```

---

### Task 4: 权限审计

**Files:**
- Create: `scripts/lib/audit-permissions.mjs`
- Test: `scripts/lib/audit-permissions.test.mjs`

**Interfaces:**
- Produces:
  - `permissionsRequiringJustification(manifest)` → `string[]`(如 `["filesystem.write","shell.allow"]`)。
  - `auditPermissions(manifest, readmeText)` → `string[]`(违规信息,空数组表示通过)。

- [ ] **Step 1: 写失败测试**

`scripts/lib/audit-permissions.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { auditPermissions, permissionsRequiringJustification } from "./audit-permissions.mjs";

test("无 flagged 权限 => 无违规,README 可空", () => {
  const m = { name: "p", permissions: { filesystem: { read: ["./**"] } } };
  assert.deepEqual(permissionsRequiringJustification(m), []);
  assert.deepEqual(auditPermissions(m, ""), []);
});

test("write 权限 flagged;README 无标题 => 违规", () => {
  const m = { name: "p", permissions: { filesystem: { write: ["./data/**"] } } };
  assert.deepEqual(auditPermissions(m, "# readme\n\nno heading here"), [
    `plugin "p" requests filesystem.write but README has no "## 权限说明" / "## Permissions" heading`,
  ]);
});

test("write 权限 flagged;README 有中文标题 => 通过", () => {
  const m = { name: "p", permissions: { filesystem: { write: ["./data/**"] } } };
  assert.deepEqual(auditPermissions(m, "## 权限说明\n写入 ./data 缓存产物"), []);
});

test("write 权限 flagged;README 有英文标题 => 通过", () => {
  const m = { name: "p", permissions: { filesystem: { write: ["./data/**"] } } };
  assert.deepEqual(auditPermissions(m, "## Permissions\nwrites to ./data"), []);
});

test("shell.allow 与 network 被 flagged", () => {
  assert.ok(permissionsRequiringJustification({ permissions: { shell: { allow: true } } }).includes("shell.allow"));
  assert.ok(permissionsRequiringJustification({ permissions: { network: { outbound: ["*"] } } }).includes("network.outbound"));
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm test`
Expected: FAIL,`Cannot find module './audit-permissions.mjs'`。

- [ ] **Step 3: 写实现**

`scripts/lib/audit-permissions.mjs`:
```js
// 权限审计:请求 shell/network/write 的插件,README 必须有「权限说明」标题。
const JUSTIFICATION_HEADING = /^##\s*(权限说明|Permissions)\s*$/im;

export function permissionsRequiringJustification(manifest) {
  const p = manifest?.permissions ?? {};
  const flagged = [];
  if (p?.shell?.allow === true) flagged.push("shell.allow");
  if (Array.isArray(p?.network?.outbound) && p.network.outbound.length > 0) flagged.push("network.outbound");
  if (Array.isArray(p?.filesystem?.write) && p.filesystem.write.length > 0) flagged.push("filesystem.write");
  return flagged;
}

export function auditPermissions(manifest, readmeText) {
  const flagged = permissionsRequiringJustification(manifest);
  if (flagged.length === 0) return [];
  if (!JUSTIFICATION_HEADING.test(String(readmeText ?? ""))) {
    return [
      `plugin "${manifest.name}" requests ${flagged.join(", ")} but README has no "## 权限说明" / "## Permissions" heading`,
    ];
  }
  return [];
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/audit-permissions.mjs scripts/lib/audit-permissions.test.mjs
git commit -m "✨ feat(scripts): 添加插件权限审计"
```

---

### Task 5: build-manifest 核心(发现+校验+组装)

**Files:**
- Create: `scripts/lib/build-manifest.mjs`
- Test: `scripts/lib/build-manifest.test.mjs`

**Interfaces:**
- Consumes: Task 2/3/4 的函数。
- Produces: `buildManifest({ pluginsRoot, skillsRoot, marketName, marketDescription, owner })` → `{ manifest, violations }`。`manifest` 形如:
  ```js
  { name, description, owner: { name }, plugins: [{ name, description?, version, source, author? }], skills: [{ name, description?, source }] }
  ```
  `violations` 为 `string[]`,非空表示校验失败。**纯函数:只读盘,不写 `.lume-plugin/marketplace.json`。**

- [ ] **Step 1: 写失败测试(用 tmpdir 构造 fixtures)**

`scripts/lib/build-manifest.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest } from "./build-manifest.mjs";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "lume-plg-"));
  const pluginsRoot = join(root, "plugins");
  const skillsRoot = join(root, "skills");
  mkdirSync(pluginsRoot, { recursive: true });
  mkdirSync(skillsRoot, { recursive: true });
  return { root, pluginsRoot, skillsRoot, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function addPlugin(pluginsRoot, name, manifestExtra = "", readme = "# x\n") {
  const dir = join(pluginsRoot, name);
  mkdirSync(dir, { recursive: true });
  const base = { schema: "lume-plugin/v1", name, version: "1.0.0", description: `${name} desc` };
  writeFileSync(join(dir, "lume-plugin.json"), JSON.stringify({ ...base, ...manifestExtra }));
  writeFileSync(join(dir, "README.md"), readme);
  writeFileSync(join(dir, "LICENSE"), "MIT");
  return dir;
}

test("合法插件 => 正确 manifest,source 相对", () => {
  const t = setup();
  addPlugin(t.pluginsRoot, "foo", { version: "1.2.3" });
  const { manifest, violations } = buildManifest({ pluginsRoot: t.pluginsRoot, skillsRoot: t.skillsRoot, marketName: "M" });
  assert.deepEqual(violations, []);
  assert.equal(manifest.plugins.length, 1);
  assert.equal(manifest.plugins[0].name, "foo");
  assert.equal(manifest.plugins[0].source, "./plugins/foo");
  assert.equal(manifest.plugins[0].version, "1.2.3");
  t.cleanup();
});

test("目录名 != manifest name => 违规", () => {
  const t = setup();
  const dir = join(t.pluginsRoot, "foo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "lume-plugin.json"), JSON.stringify({ schema: "lume-plugin/v1", name: "bar", version: "1.0.0" }));
  writeFileSync(join(dir, "README.md"), "x");
  writeFileSync(join(dir, "LICENSE"), "x");
  const { violations } = buildManifest({ pluginsRoot: t.pluginsRoot, skillsRoot: t.skillsRoot, marketName: "M" });
  assert.ok(violations.some((v) => v.includes("directory name must equal")));
  t.cleanup();
});

test("write 权限缺说明 => 违规;有说明 => 通过", () => {
  const t = setup();
  addPlugin(t.pluginsRoot, "a", { permissions: { filesystem: { write: ["./data/**"] } } }, "no heading");
  addPlugin(t.pluginsRoot, "b", { permissions: { filesystem: { write: ["./data/**"] } } }, "## 权限说明\n写入 ./data");
  const { violations } = buildManifest({ pluginsRoot: t.pluginsRoot, skillsRoot: t.skillsRoot, marketName: "M" });
  assert.ok(violations.some((v) => v.includes("\"a\"") && v.includes("权限说明")));
  assert.ok(!violations.some((v) => v.includes("\"b\"")));
  t.cleanup();
});

test("缺 LICENSE/README => 违规", () => {
  const t = setup();
  const dir = join(t.pluginsRoot, "foo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "lume-plugin.json"), JSON.stringify({ schema: "lume-plugin/v1", name: "foo", version: "1.0.0" }));
  const { violations } = buildManifest({ pluginsRoot: t.pluginsRoot, skillsRoot: t.skillsRoot, marketName: "M" });
  assert.ok(violations.some((v) => v.includes("LICENSE")));
  t.cleanup();
});

test("空 plugins+skills => 违规(至少一个)", () => {
  const t = setup();
  const { violations } = buildManifest({ pluginsRoot: t.pluginsRoot, skillsRoot: t.skillsRoot, marketName: "M" });
  assert.ok(violations.some((v) => v.includes("at least one")));
  t.cleanup();
});

test("独立技能被收录,source=./skills/<name>", () => {
  const t = setup();
  const dir = join(t.skillsRoot, "greeter");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: greeter\ndescription: hi\n---\nbody");
  const { manifest, violations } = buildManifest({ pluginsRoot: t.pluginsRoot, skillsRoot: t.skillsRoot, marketName: "M" });
  assert.deepEqual(violations, []);
  assert.equal(manifest.skills[0].source, "./skills/greeter");
  t.cleanup();
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm test`
Expected: FAIL,`Cannot find module './build-manifest.mjs'`。

- [ ] **Step 3: 写实现**

`scripts/lib/build-manifest.mjs`:
```js
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
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm test`
Expected: PASS(全部)。

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/build-manifest.mjs scripts/lib/build-manifest.test.mjs
git commit -m "✨ feat(scripts): 添加索引生成核心(发现/校验/组装)"
```

---

### Task 6: build-index CLI(写盘 / `--check`)

**Files:**
- Create: `scripts/build-index.mjs`

**Interfaces:**
- Consumes: Task 5 的 `buildManifest`。
- Produces: CLI 行为——`node scripts/build-index.mjs` 生成 `.lume-plugin/marketplace.json`;`--check` 比对,不一致或违规则非零退出。

- [ ] **Step 1: 写实现(CLI 胶水,逻辑已在 Task 5 测过)**

`scripts/build-index.mjs`:
```js
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
```

- [ ] **Step 2: 用临时空目录冒烟测试 CLI(此时 plugins/ 尚不存在,预期因「至少一个」违规而失败)**

Run: `node scripts/build-index.mjs`
Expected: 退出码 1,stderr 含 `marketplace.json must contain at least one plugin or skill`。(Task 7 加入真实插件后才会成功。)

- [ ] **Step 3: 提交**

```bash
git add scripts/build-index.mjs
git commit -m "✨ feat(scripts): 添加 build-index CLI(生成/--check)"
```

---

### Task 7: 种子插件 example-hello + 生成索引

**Files:**
- Create: `plugins/example-hello/lume-plugin.json`
- Create: `plugins/example-hello/README.md`
- Create: `plugins/example-hello/LICENSE`
- Create: `plugins/example-hello/skills/hello-world/SKILL.md`
- Create: `plugins/example-hello/hooks/hooks.json`
- Create: `plugins/example-hello/mcp.json`
- Create: `skills/.gitkeep`
- Create(generated): `.lume-plugin/marketplace.json`

**Interfaces:**
- Produces: 一个通过全部校验的示例插件(兼作贡献者模板),以及仓库首份索引。

- [ ] **Step 1: 写插件清单(含 `filesystem.write` flagged 权限,演示权限说明)**

`plugins/example-hello/lume-plugin.json`:
```json
{
  "schema": "lume-plugin/v1",
  "name": "example-hello",
  "version": "1.0.0",
  "description": "示例插件:演示 Lume 市场收录的标准结构、技能/hook/mcp 接线与权限说明写法",
  "author": "CavinHuang",
  "displayName": "Example Hello",
  "category": "Developer",
  "skills": ["./skills/"],
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./mcp.json",
  "permissions": {
    "filesystem": {
      "read": ["./**"],
      "write": ["./data/**"]
    }
  },
  "lume": { "hooksOnly": false }
}
```

- [ ] **Step 2: 写 README(含 `## 权限说明`,否则权限审计失败)**

`plugins/example-hello/README.md`:
````markdown
# Example Hello

Lume 插件市场的**示例插件**,也是贡献者模板。演示标准目录结构、skill / hook / mcp 三种能力接线,以及权限说明的写法。

## 能力

- **Skill**:`hello-world` — 一个最小可用的示例技能。
- **Hook**:`SessionStart` 时打印一行日志(结构演示)。
- **MCP**:`echo` 演示服务器(结构演示)。

## 权限说明

| 权限 | 用途 |
|---|---|
| `filesystem.read: ./**` | 读取插件自身目录资源 |
| `filesystem.write: ./data/**` | 演示写权限——把会话产物写入 `./data/`(实际插件按需声明) |

本插件**不**请求 `shell` 或 `network`。真实插件请遵循最小权限原则:仅在确实需要时声明,并在此逐项解释。

## 安装

通过 Lume「插件 & 技能市场」UI 安装,或参见仓库根 README 订阅官方市场源。
````

- [ ] **Step 3: 写 LICENSE**

`plugins/example-hello/LICENSE`:
```
MIT License

Copyright (c) 2026 CavinHuang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: 写 hello-world skill**

`plugins/example-hello/skills/hello-world/SKILL.md`:
```markdown
---
name: hello-world
description: 示例技能:被调用时回一句问候,演示 skill 接线。
---

# Hello World

当用户说"打个招呼"或"演示 hello"时,用一句话问候并说明自己是 example-hello 插件的示例技能。
```

- [ ] **Step 5: 写 hooks.json(结构演示)**

`plugins/example-hello/hooks/hooks.json`:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "echo 'example-hello plugin loaded'",
        "timeout": 5
      }
    ]
  }
}
```

- [ ] **Step 6: 写 mcp.json(结构演示)**

`plugins/example-hello/mcp.json`:
```json
{
  "mcpServers": {
    "example-echo": {
      "command": "echo",
      "args": ["hello from example-hello"]
    }
  }
}
```

- [ ] **Step 7: 建 skills/ 占位**

`skills/.gitkeep`:
```
```
(空文件,保留目录结构。)

- [ ] **Step 8: 生成索引并验证一致**

Run: `npm run build:index`
Expected: `✓ wrote .../.lume-plugin/marketplace.json (1 plugins, 0 skills)`

Run: `npm run check:index`
Expected: `✓ marketplace.json in sync`

检查生成内容(应含 example-hello 一条,source 为相对路径):
Run: `cat .lume-plugin/marketplace.json`
Expected 关键字段:
```json
{
  "name": "Lume Plugins",
  "description": "Lume 官方精选插件与技能集合",
  "owner": { "name": "CavinHuang" },
  "plugins": [
    {
      "name": "example-hello",
      "description": "示例插件:...",
      "version": "1.0.0",
      "source": "./plugins/example-hello",
      "author": { "name": "CavinHuang" }
    }
  ],
  "skills": []
}
```

- [ ] **Step 9: 提交**

```bash
git add plugins/example-hello skills/.gitkeep .lume-plugin/marketplace.json
git commit -m "✨ feat(plugin): 添加 example-hello 种子插件并生成首份索引"
```

---

### Task 8: PR 校验 CI(validate.yml)

**Files:**
- Create: `.github/workflows/validate.yml`

- [ ] **Step 1: 写 workflow**

`.github/workflows/validate.yml`:
```yaml
name: validate

on:
  pull_request:
    paths:
      - "plugins/**"
      - "skills/**"
      - "scripts/**"
      - ".lume-plugin/marketplace.json"
      - "package.json"
      - ".github/workflows/validate.yml"

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: 单元测试
        run: npm test
      - name: 索引一致性 + 权限审计 + 结构校验
        run: npm run check:index
```

- [ ] **Step 2: 本地用 `--check` 模拟 CI 的两步**

Run: `npm test && npm run check:index`
Expected: 测试全 PASS + `✓ marketplace.json in sync`,退出码 0。

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/validate.yml
git commit -m "✨ feat(ci): 添加 PR 校验流水线(测试+索引一致性+权限审计)"
```

---

### Task 9: 索引安全网 CI(publish-index.yml)

**Files:**
- Create: `.github/workflows/publish-index.yml`

- [ ] **Step 1: 写 workflow**

`.github/workflows/publish-index.yml`:
```yaml
name: publish-index

on:
  push:
    branches: [main]
    paths:
      - "plugins/**"
      - "skills/**"
      - "scripts/**"

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: 重新生成索引
        run: npm run build:index
      - name: 若有变更则提交
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if ! git diff --quiet; then
            git add .lume-plugin/marketplace.json
            git commit -m "🔧 chore: 同步 marketplace.json 索引"
            git push
          else
            echo "index already in sync"
          fi
```

- [ ] **Step 2: YAML 语法本地校验(若有 python)**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/publish-index.yml')); print('yaml ok')"`
Expected: `yaml ok`。若无 python3,跳过(语法已在 Step 1 仔细核对)。

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/publish-index.yml
git commit -m "✨ feat(ci): 添加索引安全网(合入 main 后自动同步)"
```

---

### Task 10: Copilot 指令 + GitHub 模板 + CODEOWNERS

**Files:**
- Create: `.github/copilot-instructions.md`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `.github/ISSUE_TEMPLATE/plugin-submission.yml`
- Create: `.github/CODEOWNERS`

- [ ] **Step 1: 写 Copilot 评审指令**

`.github/copilot-instructions.md`:
````markdown
# Copilot 评审指引 — lume-plugins 官方插件市场

评审每个 PR 时,除通用代码质量外,重点检查以下项。

## 安全(最高优先级,发现即标红)
- `eval` / `new Function(` / `child_process.exec` 拼接输入、动态下载并执行代码。
- 外发用户数据:硬编码外部 URL、向非知名域名 `fetch`/`http`、读取 `~/.lume` 或环境变量后外传。
- 混淆代码、大段不可读 base64 payload、无必要的 native/bin 二进制。

## 权限最小化
- 清单请求 `shell.allow` / 非空 `network.outbound` / 宽 `filesystem.write`(如 `./**`)时,README 必须有 `## 权限说明` 段逐项解释,否则标红。
- 指出 `tools.deny` 移除危险工具的影响。

## 结构
- 目录名必须等于 `lume-plugin.json` 的 `name`。
- 必须有 `LICENSE` 和 `README.md`。
- `source` 路径必须 `./` 开头、无 `..`。

## 不要做
- 不建议改动 `.lume-plugin/marketplace.json`——它是 `scripts/build-index.mjs` 的生成物。
- 不要求加无谓的抽象/配置项。
````

- [ ] **Step 2: 写 PR 模板**

`.github/PULL_REQUEST_TEMPLATE.md`:
```markdown
## 变更说明

<!-- 这个 PR 新增/更新了什么插件或技能? -->

## 自查清单

- [ ] 目录名与 `lume-plugin.json` 的 `name` 一致(或 `SKILL.md` frontmatter `name` 一致)
- [ ] 含 `LICENSE` 与 `README.md`
- [ ] 清单 `schema: "lume-plugin/v1"`,`version` 为合法 semver
- [ ] 若请求 shell / network / write 权限,README 已含 `## 权限说明` 逐项解释
- [ ] 已本地运行 `npm run build:index` 更新 `.lume-plugin/marketplace.json`
- [ ] 已本地运行 `npm test` 与 `npm run check:index` 通过

## 权限说明(若有 flagged 权限)

<!-- 逐项解释为何需要每个非默认权限。无 flagged 权限可删本节。 -->
```

- [ ] **Step 3: 写 Issue 提案模板**

`.github/ISSUE_TEMPLATE/plugin-submission.yml`:
```yaml
name: 插件收录提案
description: 提议官方市场收录一个插件(代码以 PR 形式提交,本 Issue 用于讨论)
labels: ["submission"]
body:
  - type: input
    id: name
    attributes:
      label: 插件名
      placeholder: my-plugin
    validations:
      required: true
  - type: textarea
    id: description
    attributes:
      label: 它做什么
    validations:
      required: true
  - type: textarea
    id: permissions
    attributes:
      label: 需要的权限及理由
      description: 逐项列出 shell/network/write 等权限及最小化理由
    validations:
      required: true
  - type: input
    id: pr
    attributes:
      label: 关联 PR
      placeholder: "#123"
```

- [ ] **Step 4: 写 CODEOWNERS**

`.github/CODEOWNERS`:
```
# 核心团队对所有变更必审。按需增加 @handle。
* @CavinHuang
```

- [ ] **Step 5: 提交**

```bash
git add .github/copilot-instructions.md .github/PULL_REQUEST_TEMPLATE.md .github/ISSUE_TEMPLATE/plugin-submission.yml .github/CODEOWNERS
git commit -m "✨ feat(ci): 添加 Copilot 评审指令与收录流程模板"
```

---

### Task 11: 文档

**Files:**
- Create: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `docs/SUBMISSION_GUIDE.md`
- Create: `docs/REVIEW_CHECKLIST.md`
- Create: `SECURITY.md`
- Create: `LICENSE`

- [ ] **Step 1: 写仓库根 README**

`README.md`:
````markdown
# Lume Plugins

[Lume](https://github.com/CavinHuang/lume) 的**官方精选插件与技能市场**。核心团队维护,人工审核 + 安全审计。

## 订阅市场

在 `~/.lume/config.yml` 加入:

```yaml
plugins:
  marketSources:
    - id: lume-official
      name: Lume 官方市场
      kind: remote-index
      enabled: true
      url: https://github.com/CavinHuang/lume-plugins
```

之后在 Lume「插件 & 技能市场」UI 浏览、查看详情、安装。安装时 Lume 自动拉取本仓库、解压插件、弹出权限审查。

## 收录一个插件

1. 复制 `plugins/example-hello/` 作为模板。
2. 改目录名与 `lume-plugin.json` 的 `name`(须一致,`^[a-z0-9_-]{1,64}$`)。
3. 写 `README.md`,对每个 `shell`/`network`/`write` 权限在 `## 权限说明` 下逐项解释。
4. 本地运行:`npm run build:index`(更新索引)、`npm test`、`npm run check:index`。
5. 开 PR,套用模板勾选自查清单。

详见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [docs/SUBMISSION_GUIDE.md](./docs/SUBMISSION_GUIDE.md)。

## 索引说明

`.lume-plugin/marketplace.json` 由 `scripts/build-index.mjs` **自动生成**,请勿手改。CI 会校验其与目录一致。

## License

MIT
````

- [ ] **Step 2: 写 CONTRIBUTING.md**

`CONTRIBUTING.md`:
```markdown
# 贡献指南

本仓库是 Lume 官方精选市场。欢迎通过 PR 提交插件或独立技能。

- **提交规范**:每个 PR 一个插件/技能,目录名与清单 `name` 一致。
- **权限最小化**:仅在确实需要时声明 `shell`/`network`/`write`,并在 README `## 权限说明` 逐项解释。
- **索引**:`.lume-plugin/marketplace.json` 是生成物,运行 `npm run build:index` 更新,勿手改。
- **本地校验**:`npm test && npm run check:index` 须通过。
- **审核**:核心团队人工审核 + Copilot AI 初筛,依据 [docs/REVIEW_CHECKLIST.md](./docs/REVIEW_CHECKLIST.md)。

完整步骤见 [docs/SUBMISSION_GUIDE.md](./docs/SUBMISSION_GUIDE.md)。
```

- [ ] **Step 3: 写 SUBMISSION_GUIDE.md**

`docs/SUBMISSION_GUIDE.md`:
````markdown
# 插件收录指南

## 目录结构(插件)

```
plugins/<name>/
├── lume-plugin.json     # schema: "lume-plugin/v1"
├── README.md            # 含 ## 权限说明(若有 flagged 权限)
├── LICENSE              # MIT 或其他 OSI 许可
├── skills/<skill>/SKILL.md   # 可选
├── hooks/hooks.json          # 可选
└── mcp.json                  # 可选
```

## 硬性规则

- 目录名 === `lume-plugin.json` 的 `name`,且匹配 `^[a-z0-9_-]{1,64}$`。
- `version` 为合法 semver(`1.0.0`)。
- 清单内所有路径以 `./` 开头,不含 `..`。
- 请求 `shell.allow` / 非空 `network.outbound` / 非空 `filesystem.write` 时,README 必须含 `## 权限说明`(或 `## Permissions`)标题。

## 本地预检

```bash
npm install      # 无依赖,仅确保 npm 可用;可省略
npm run build:index
npm test
npm run check:index
```

三者均通过即可开 PR。

## 独立技能

放在 `skills/<name>/SKILL.md`(frontmatter `name` 须等于目录名)。其余规则同上。
````

- [ ] **Step 4: 写 REVIEW_CHECKLIST.md**

`docs/REVIEW_CHECKLIST.md`:
```markdown
# 审核清单(核心团队)

每个插件 PR 须逐项确认:

## 功能
- [ ] 功能真实可用,非占位/玩具。
- [ ] 命名/分类合理,与已有插件不重复。

## 权限
- [ ] 权限最小化,无多余 shell/network/write。
- [ ] 每个 flagged 权限在 README `## 权限说明` 有合理理由。

## 安全
- [ ] 无混淆代码、无大段 base64 payload。
- [ ] 无外发用户数据(硬编码 URL、向非知名域名请求、读取 `~/.lume` 或 env 后外传)。
- [ ] 无 `eval`/`new Function`/动态下载执行。

## 合规
- [ ] `LICENSE` 存在且为 OSI 许可。
- [ ] 无明显侵权或敏感内容。

## 一致性
- [ ] `npm run check:index` 通过(索引与目录同步)。
```

- [ ] **Step 5: 写 SECURITY.md**

`SECURITY.md`:
```markdown
# 安全策略

发现本市场收录插件的安全问题,请**勿**公开 Issue。

## 私下披露

优先使用 GitHub Security Advisories:仓库 `Security` → `Report a vulnerability`。

或邮件联系仓库 owner(见 GitHub profile)。

## 响应

收到报告后会评估影响,必要时下架相关插件版本并通知用户。
```

- [ ] **Step 6: 写仓库级 LICENSE(MIT)**

`LICENSE`:
```
MIT License

Copyright (c) 2026 CavinHuang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 7: 最终本地校验**

Run: `npm test && npm run check:index`
Expected: 全 PASS,索引一致。

Run: `git ls-files`
Expected: 包含所有 11 个任务创建的文件,无遗漏、无多余生成物。

- [ ] **Step 8: 提交**

```bash
git add README.md CONTRIBUTING.md docs/SUBMISSION_GUIDE.md docs/REVIEW_CHECKLIST.md SECURITY.md LICENSE
git commit -m "📝 docs: 添加 README/贡献指南/收录指南/审核清单/安全策略/许可证"
```

---

## Self-Review

**1. Spec 覆盖**:逐条对照 spec 章节——
- §3 硬约束(manifest 路径/相对 source/github-only/至少一条):Task 5+6 实现(`buildManifest` 校验 `source` 相对、schema、name=dir、至少一条);`.lume-plugin/marketplace.json` 路径在 Task 6。
- §4 布局:Task 1-11 全部文件覆盖。
- §5 索引契约:Task 5(组装)+ Task 6(序列化)。
- §6 收录规范(name/semver/path/必备文件/权限说明):Task 2+5。
- §7 生成脚本 + 镜像校验:Task 2+5+6(`manifest-rules.mjs` 顶部登记镜像来源)。
- §8 CI(validate + publish-index):Task 8+9。
- §9 审核流程:Task 10(PR 模板)+ Task 11(REVIEW_CHECKLIST);CODEOWNERS 在 Task 10。
- §10 Copilot 接入:Task 10(`copilot-instructions.md`)。注:开启 ruleset 是仓库 Settings 手动操作,不在代码任务内——已记为执行后手动步骤(见下)。
- §11 订阅安装:Task 11 README。
- §12 初始化内容:Task 1-11 全覆盖。
- §13 风险:镜像漂移在 Task 2 注释登记;无版本兼容闸记入 spec。

**2. 占位符扫描**:无 TBD/TODO;每步含完整代码或确切命令与预期输出。

**3. 类型一致性**:`buildManifest` 返回 `{manifest, violations}` 在 Task 5 定义、Task 6 消费,签名一致;`auditPermissions`/`permissionsRequiringJustification`/`parseSkillFrontmatter`/三个 validator 命名在定义与测试中一致;CLI 环境变量 `MARKET_NAME`/`MARKET_DESC`/`MARKET_OWNER` 与默认值一致。

**4. 执行后手动步骤(非代码任务)**:
- GitHub 仓库 Settings → Rules → Rulesets 新建 Pull Request ruleset,开启 automatic Copilot review(§10)。
- 确认 Settings → Copilot → Code review 的 "Use custom instructions when reviewing pull requests" 已开。
- 启用分支保护:PR 需 `validate` 通过 + CODEOWNERS 审批。
- 推送远端:`git remote add origin git@github.com:CavinHuang/lume-plugins.git && git push -u origin main`(远端需先在 GitHub 建空仓库)。
