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
