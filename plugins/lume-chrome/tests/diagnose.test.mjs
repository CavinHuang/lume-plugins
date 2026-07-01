import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("diagnose launches sibling scripts using valid filesystem paths", () => {
  const result = spawnSync(process.execPath, ["scripts/diagnose.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8"
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0);
  assert.match(output, /## chrome-is-running\.mjs/);
  assert.match(output, /## check-extension-installed\.mjs/);
  assert.match(output, /## check-native-host-manifest\.mjs/);
  assert.doesNotMatch(output, /MODULE_NOT_FOUND/);
  assert.doesNotMatch(output, /D:\\D:\\/);
});
