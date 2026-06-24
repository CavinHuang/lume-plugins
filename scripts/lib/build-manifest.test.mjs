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
