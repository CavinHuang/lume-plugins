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
