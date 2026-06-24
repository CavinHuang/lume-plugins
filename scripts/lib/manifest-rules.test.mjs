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
