# 插件市场镜像服务

GitHub 仍是唯一内容源。Dokploy 监听仓库分支，每次 push 后自动 clone、构建并部署同一 Git commit 的服务与插件资源。镜像只发布按 commit 固定的只读快照，不需要 GitHub Actions 额外生成、提交或推送 index。

## Dokploy 部署

在 Dokploy 创建 Docker Compose 服务：

1. Git Provider 选择本仓库及部署分支（通常为 `main`）。
2. Compose Path 使用 `docker-compose.yml`。
3. 开启 Auto Deploy；Dokploy 会在每次目标分支 push 后自动部署。
4. 为 `mirror` 服务绑定域名，容器端口填写 `8787`。

公开接口为：

- `GET /healthz`
- `GET /v1/catalog`
- `GET /v1/snapshots/:commit/archive.tar.gz`
- `GET /v1/snapshots/:commit/raw/*`

新增或调整资源时，在本地运行 `npm run build:index`，将资源和更新后的 `.lume-plugin/marketplace.json` 放进同一次提交、只 push 一次。PR 校验会拒绝不一致的 index，Dokploy 则直接部署该提交。

客户端将官方市场配置为 `mirrorUrl: https://plugins.example.com`；镜像不可用时 Lume 自动回退 GitHub。
