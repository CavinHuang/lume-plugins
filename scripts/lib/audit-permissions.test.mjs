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
