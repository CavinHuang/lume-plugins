# Lume Plugins

[Lume](https://github.com/CavinHuang/lume) 的**官方精选插件与技能市场**。核心团队维护,人工审核 + 安全审计。

## 订阅市场

在 `~/.lume/config.yml` 加入:

```yaml
plugins:
  marketSources:
    - id: lume-official
      name: Lume 官方市场
      kind: remote-index
      enabled: true
      url: https://github.com/CavinHuang/lume-plugins
```

之后在 Lume「插件 & 技能市场」UI 浏览、查看详情、安装。安装时 Lume 自动拉取本仓库、解压插件、弹出权限审查。

## 收录一个插件

1. 复制 `plugins/example-hello/` 作为模板。
2. 改目录名与 `lume-plugin.json` 的 `name`(须一致,`^[a-z0-9_-]{1,64}$`)。
3. 写 `README.md`,对每个 `shell`/`network`/`write` 权限在 `## 权限说明` 下逐项解释。
4. 本地运行:`npm run build:index`(更新索引)、`npm test`、`npm run check:index`。
5. 开 PR,套用模板勾选自查清单。

详见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [docs/SUBMISSION_GUIDE.md](./docs/SUBMISSION_GUIDE.md)。

## 索引说明

`.lume-plugin/marketplace.json` 由 `scripts/build-index.mjs` **自动生成**,请勿手改。CI 会校验其与目录一致。

## License

MIT
