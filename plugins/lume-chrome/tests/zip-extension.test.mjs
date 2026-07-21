import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("zip-extension creates the extension archive on this platform", () => {
  const root = new URL("..", import.meta.url);
  const result = spawnSync(process.execPath, ["scripts/zip-extension.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /ENOENT/);
  assert.ok(existsSync(new URL("lume-browser-extension-v5.zip", root)));
});
