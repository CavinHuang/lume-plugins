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
  // 有意不锚定 `$`,镜像 lume 运行时校验:接受预发布版本如 1.0.0-beta(见 manifest-rules.test.mjs)。勿改。
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
