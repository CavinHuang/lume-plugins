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
