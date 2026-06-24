# 插件收录指南

## 目录结构(插件)

```
plugins/<name>/
├── lume-plugin.json     # schema: "lume-plugin/v1"
├── README.md            # 含 ## 权限说明(若有 flagged 权限)
├── LICENSE              # MIT 或其他 OSI 许可
├── skills/<skill>/SKILL.md   # 可选
├── hooks/hooks.json          # 可选
└── mcp.json                  # 可选
```

## 硬性规则

- 目录名 === `lume-plugin.json` 的 `name`,且匹配 `^[a-z0-9_-]{1,64}$`。
- `version` 为合法 semver(`1.0.0`)。
- 清单内所有路径以 `./` 开头,不含 `..`。
- 请求 `shell.allow` / 非空 `network.outbound` / 非空 `filesystem.write` 时,README 必须含 `## 权限说明`(或 `## Permissions`)标题。

## 本地预检

```bash
npm install      # 无依赖,仅确保 npm 可用;可省略
npm run build:index
npm test
npm run check:index
```

三者均通过即可开 PR。

## 独立技能

放在 `skills/<name>/SKILL.md`(frontmatter `name` 须等于目录名)。其余规则同上。
