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
