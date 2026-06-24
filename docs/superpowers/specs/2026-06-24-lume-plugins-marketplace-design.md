# Lume 官方插件市场收录仓库设计

- **日期**:2026-06-24
- **仓库**:`CavinHuang/lume-plugins`(GitHub)
- **定位**:官方精选市场(核心团队维护 + 人工审核 + 安全审计)
- **状态**:设计待评审

---

## 1. 背景与目标

Lume 的插件市场「消费端」已完整实现于 sidecar(`apps/sidecar/src/services/plugins/plugin-market-service.ts`):远程拉取、安装/更新/卸载、权限审查、状态管理、Web UI(`apps/web/.../SkillsMarketView.tsx`)、配置项 `plugins.marketSources` 全部就绪——但**默认 `marketSources: []`,没有接任何远程源**。

本仓库的目标:**填补这个空缺**,提供一个官方维护、可被 Lume 直接订阅的远程插件与技能收录仓库(`kind: remote-index`)。用户只需在 `~/.lume/config.yml` 加一条配置即可接入,**Lume 侧零代码改动**。

「收录」的含义:这是一个**把插件代码 vendor 进来的精选 monorepo**——贡献者把插件源码作为子目录提交,经审核后登记进索引。不是只放外链的索引站(原因见 §3)。

---

## 2. 范围与非目标

**范围内**:
- 官方精选的插件与独立技能收录(vendored monorepo)。
- 自动生成索引 + 严格 CI 闸口(方案 A)。
- 收录/审核流程、安全模型、文档。
- GitHub 原生 Copilot AI 评审作为第一道初筛。

**非目标**:
- 不做「只放链接、代码在别处」的索引站(Lume 当前实现不支持,见 §3)。
- 不实现 `lume plugin install` 之类 CLI(消费端已由 Lume UI/sidecar 承担)。
- 不实现插件签名 / 分发 CDN(安装走 GitHub tarball)。
- 不引入运行时代码——本仓库纯静态资源 + 生成脚本 + CI。

---

## 3. 关键约束(来自 Lume 源码,硬约束)

| 约束 | 来源 | 对本仓库的含义 |
|---|---|---|
| 索引必须在 `.lume-plugin/marketplace.json` | `MARKETPLACE_MANIFEST_PATH` 常量 (`plugin-market-service.ts:122`) | 索引路径写死 |
| `source` 必须是**相对目录路径** | `assertRelativeMarketplaceSource` (`:913`) 拒绝绝对路径/盘符/URL scheme | 不能指向别的 GitHub 仓库 |
| 条目的 `owner/repo/ref` 继承自市场仓库本身 | `readRemoteMarketIndex` (`:583-590`) | 插件代码必须**物理存在**于本仓库 |
| 安装时拉**本仓库的 tarball** | `stageGitHubTarball` (`:674`) | git submodule 无效(tarball 与 tree API 中均非 blob) |
| 仅支持 github.com | `parseGitHubRootUrl` (`:935`) | 必须 GitHub 托管 |
| 索引至少含 `plugins[]` 或 `skills[]` 之一 | `readMarketplaceManifest` (`:607-609`) | 空索引非法 |

**结论**:收录仓库必须是 vendored monorepo。每个插件目录会被 GitHub tree API 扫描,manifest 探测顺序为:`.lume-plugin/plugin.json` → `lume-plugin.json` → `.codex-plugin/plugin.json` → `plugin.json`(`resolveGitHubManifestPath:965`)。

---

## 4. 仓库总体布局

```
lume-plugins/
├── .lume-plugin/
│   └── marketplace.json            # 【生成物】索引,Lume 写死从此路径读
├── plugins/
│   └── example-hello/             # 种子示例插件(也是贡献者模板)
│       ├── lume-plugin.json       # schema: "lume-plugin/v1"
│       ├── README.md              # 作用 + 「权限说明」段(强制)
│       ├── LICENSE                # MIT
│       ├── skills/hello-world/SKILL.md
│       ├── hooks/hooks.json
│       └── mcp.json
├── skills/                        # 独立技能(初始为空,结构就绪)
│   └── .gitkeep
├── scripts/
│   ├── build-index.mjs            # 扫描 plugins/+skills/ → 生成 marketplace.json
│   └── lib/
│       └── manifest-rules.mjs     # 从 Lume 镜像的 3 个校验函数
├── .github/
│   ├── copilot-instructions.md    # 钉住 Copilot AI 评审重点(见 §10)
│   ├── workflows/
│   │   ├── validate.yml           # PR 闸口:清单/索引/权限/结构
│   │   └── publish-index.yml      # 合入 main:重生成 + 安全网提交
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── ISSUE_TEMPLATE/plugin-submission.yml
│   └── CODEOWNERS                 # 核心团队必审
├── docs/
│   ├── SUBMISSION_GUIDE.md        # 收录指南
│   └── REVIEW_CHECKLIST.md        # 审核清单
├── README.md                      # 是什么 + 如何订阅 + 如何提交
├── CONTRIBUTING.md                # 指向 docs/
├── SECURITY.md                    # 漏洞披露路径
├── LICENSE                        # MIT(仓库级默认)
└── package.json                   # 仅 scripts,零依赖
```

`.lume-plugin/marketplace.json` 虽是生成物但**必须提交**(Lume 从 raw.githubusercontent.com 的默认分支读它)。它像 lockfile:CI 保证不漂移。

---

## 5. 索引契约(`.lume-plugin/marketplace.json`)

严格按 Lume 的 `MarketplaceManifest` 类型(`packages/shared/src/types/plugin-market.ts:45-51`)生成:

```json
{
  "name": "Lume Plugins",
  "description": "Lume 官方精选插件与技能集合",
  "owner": { "name": "CavinHuang" },
  "plugins": [
    {
      "name": "example-hello",
      "description": "示例插件:演示市场收录的标准结构与权限说明",
      "version": "1.0.0",
      "source": "./plugins/example-hello",
      "author": { "name": "CavinHuang" }
    }
  ],
  "skills": []
}
```

- 每条 `source` 恒为 `./plugins/<name>` 或 `./skills/<name>`(相对仓库根)。
- `name/version/description/author` 全部从插件清单 / `SKILL.md` 自动提取,**人工不碰**。
- 同步模型:PR 侧严格(失败即挡,提示 `npm run build:index`)+ 合入后安全网重提交(见 §8),保证 `main` 上索引永远正确。

---

## 6. 插件 / 技能收录规范

**插件** `plugins/<name>/`:

| 文件 | 要求 |
|---|---|
| `lume-plugin.json` | 必需;`schema:"lume-plugin/v1"`;合法 name(`^[a-z0-9_-]{1,64}$`)/semver(`^\d+\.\d+\.\d+`);路径必须 `./` 开头、无 `..` |
| `README.md` | 必需;含「权限说明」段,逐项解释每个非默认权限 |
| `LICENSE` | 必需;默认 MIT,允许其他 OSI 许可 |
| `skills/` `hooks/hooks.json` `mcp.json` | 可选,按需 |

**技能** `skills/<name>/`:`SKILL.md`(frontmatter 含 `name`/`description`)+ 推荐 `README.md`。

**命名约束**:目录名 **必须等于** 清单里的 `name`(CI 强制),保证 `source` 路径可预测。

**权限最小化(触发人工 review 高亮)**:请求 `permissions.shell.allow: true`、非空 `permissions.network.outbound`、或宽泛 `permissions.filesystem.write`(如 `./**`)的插件,README **必须**包含一个 `## 权限说明` 二级标题(CI 按该标题行 grep,中英文标题均可:`权限说明` 或 `Permissions`),并在其下逐项解释每个非默认权限,否则 CI 失败。

---

## 7. 索引生成脚本 `scripts/build-index.mjs`

**零依赖、纯 Node**(`"type":"module"`,CI 用 `actions/setup-node`,不需要 bun)。

逻辑:
1. 遍历 `plugins/*/lume-plugin.json` 与 `skills/*/SKILL.md`;
2. 用**镜像自 Lume 的 3 个校验函数**(`scripts/lib/manifest-rules.mjs`,从 `packages/sdk/src/plugins/manifest.ts` 复制 `validatePluginName`/`validateSemver`/`validatePluginPath`,~20 行)做结构校验;
3. 校验目录名 === 清单 `name`;
4. 提取字段,按 name 排序(确定性输出 → 干净 diff),写 `.lume-plugin/marketplace.json`(稳定键序 + 2 空格缩进)。

**为什么镜像而非 `import { parseManifest }`**:`@lume/agent-sdk` 当前 `0.0.0`、入口为裸 TS(`main: ./src/index.ts`),未发布到 npm,无法作为依赖引入。镜像这 3 个纯函数无副作用,且 Lume 运行时会用真正的 `parseManifest` 再校验一遍——市场侧校验只是「提前拦住明显错误」,漂移的最坏情况是插件通过市场 CI 但安装时被 Lume 拦下(可接受,下游兜底)。`manifest-rules.mjs` 顶部注明镜像来源 commit。

`package.json`:
```json
{
  "name": "lume-plugins",
  "private": true,
  "type": "module",
  "scripts": {
    "build:index": "node scripts/build-index.mjs",
    "check:index": "node scripts/build-index.mjs --check"
  }
}
```

`--check`:生成后与已提交文件 diff,不一致则非零退出(供 CI 与本地预检)。

---

## 8. CI 流水线

**`.github/workflows/validate.yml`(每个 PR 必跑)**:
1. **清单合法性**:对每个 `plugins/*/lume-plugin.json` 跑镜像校验函数;
2. **索引一致性**:运行 `node scripts/build-index.mjs --check`——若提交的 `marketplace.json` 与生成结果不一致 → 失败,提示 `run npm run build:index`;
3. **权限审计**:扫描请求 shell/network/宽写权限的插件,若 README 无「权限说明」段 → 失败;
4. **结构 lint**:目录名 === name、必备文件存在、无游离文件、无 `..` 路径。

**`.github/workflows/publish-index.yml`(合入 main 后)**:重新生成索引,若有变更则机器人提交回 main(安全网;正常情况下 PR 已保证一致)。

**策略**:PR 侧严格(失败即挡)+ 合入后安全网。PR diff 里能清楚看到索引变化,不会有「神秘机器人提交」。

---

## 9. 审核流程

```
CI(validate.yml)  →  Copilot AI 评审(初筛)  →  核心团队人工 review  →  合入 main
   机械硬错              语义/安全 smell            收录决策(人定)
```

**提交路径(贡献者)**:
1. 复制 `plugins/example-hello/` 作为模板,改名改内容;
2. 本地 `npm run build:index` 生成索引(或让 CI/维护者补);
3. 开 PR,套用 `PULL_REQUEST_TEMPLATE.md`(勾选:已写权限说明、已加 LICENSE、清单合法);
4. `CODEOWNERS` 自动要求核心团队 review。

**审核清单 `docs/REVIEW_CHECKLIST.md`(人工判断)**:
- 功能真实可用,非占位/玩具;
- 权限最小且每项有合理理由;
- 无可疑行为(混淆代码、外发用户数据、`eval`/动态下载执行、宽网络请求);
- 许可证合规、无侵权;
- 命名/分类合理,与已有插件不重复。

**安全模型**:Lume 已在安装时强制 `permissionsHash` 审查——市场侧只保证「收录进来的东西权限透明、有说明、经过人眼」。`SECURITY.md` 给私下披露邮箱,GitHub `security/advisories` 优先于公开 issue。

---

## 10. GitHub Copilot AI 评审接入

作为 CI 与人工之间的「第一道语义/安全初筛」,建议性、非硬闸。

**接入两步**:

1. **开启自动评审**:仓库 `Settings → Rules → Rulesets → New ruleset → Pull request ruleset`,开启 automatic Copilot review(2025-09 起独立规则)。或先手动 `/copilot-review` 试水。

2. **`.github/copilot-instructions.md` 钉住评审重点**(务必确认 `Repo Settings → Copilot → Code review` 里 "Use custom instructions when reviewing pull requests" 已开):

```markdown
# Copilot 评审指引 — lume-plugins 官方插件市场

## 安全(最高优先级,发现即标红)
- eval / new Function( / child_process.exec 拼接输入、动态下载并执行代码
- 外发用户数据:硬编码外部 URL、向非知名域名 fetch/http、读取 ~/.lume 或环境变量后外传
- 混淆代码、大段不可读 base64 payload、无必要的 native/bin 二进制

## 权限最小化
- 清单请求 shell.allow / 非空 network.outbound / 宽 filesystem.write(如 ./**)时,
  README 必须有「权限说明」逐项解释,否则标红
- 指出 tools.deny 移除危险工具的影响

## 结构
- 目录名必须 == lume-plugin.json 的 name
- 必须有 LICENSE 和 README.md
- source 路径必须 ./ 开头、无 ..

## 不要做
- 不建议改 .lume-plugin/marketplace.json(生成物,由脚本产出)
- 不要求加无谓的抽象/配置
```

**边界**:
- **建议性、非硬闸**:Copilot 发评论,不能像 CI 那样挡 PR。硬保证仍靠 `validate.yml` + 人工。
- **偶尔忽略指令**:社区反馈它有时不遵从自定义指令——故「权限说明缺失」等可机器判定的检查仍放进 CI(§8 步骤 3)做硬保证,Copilot 只做补充。
- **取决于 Copilot 计划**:自动评审能力与账号/组织 Copilot 计划有关;以仓库 Settings 能否开启该 ruleset 为准。
- **更可控的替代**:若需「硬闸 + 自定义 rubric」,可不用原生 Copilot 而在 `validate.yml` 加调 LLM 的 Action 步骤(带评分卡,不达标即失败)。本设计先用零维护的原生方案。

---

## 11. 用户订阅与安装(README 内容)

用户在 `~/.lume/config.yml` 加:
```yaml
plugins:
  marketSources:
    - id: lume-official
      name: Lume 官方市场
      kind: remote-index
      enabled: true
      url: https://github.com/CavinHuang/lume-plugins
```
之后在 Lume「插件 & 技能市场」UI 浏览、inspect、安装。安装时 Lume 自动拉取本仓库 tarball、解压 `plugins/<name>/` 到 `~/.lume/plugins/<id>/<version>/`、弹权限审查——**市场仓库侧零运行时代码**。

---

## 12. 初始化内容(第一个 PR 范围)

- 完整目录骨架(§4);
- `plugins/example-hello/`:基于 Lume 现有 `plugins/test-codex` 改造——改名 `example-hello`,补真实 `README.md`(含权限说明)与 `LICENSE`,清理测试痕迹;保留 hello-world skill + SessionStart hook 作为最小可用演示;
- `scripts/build-index.mjs` + `lib/manifest-rules.mjs`;
- `.github/copilot-instructions.md` + `validate.yml` + `publish-index.yml` + PR/Issue 模板 + `CODEOWNERS`;
- `README.md` / `CONTRIBUTING.md` / `docs/*` / `SECURITY.md` / `LICENSE` / `package.json`;
- 首次生成的 `.lume-plugin/marketplace.json`(含 example-hello 一条)。

---

## 13. 已知耦合与风险

1. **校验函数镜像漂移**:`manifest-rules.mjs` 手动从 Lume 复制,Lume 改规则需手动同步。缓解:注明镜像来源 commit;运行时 Lume 兜底。
2. **不能收录「代码在别处」的插件**:硬约束;作者若想自主更新只能在本仓库提 PR。
3. **仓库体积**:所有插件代码在内,tarball 随收录量增长。缓解:CI 可加体积阈值告警;`data/` 不入库。
4. **无版本兼容闸**:Lume 当前不校验插件要求的 Lume 版本。缓解:约定 README 标注兼容 Lume 版本(软约束)。

---

## 14. 决策记录

| 决策点 | 选择 | 理由 |
|---|---|---|
| 市场定位 | 官方精选(核心团队 + 人工审核 + 安全审计) | 质量优先、高信任 |
| 仓库 | `CavinHuang/lume-plugins` | 与主仓同 owner,语义清晰 |
| 收录范围 | 插件 + 独立技能 | 索引与 UI 本就支持 `skills[]` |
| 初始种子 | 含 1 个示例插件 | 兼作贡献者模板 |
| 落地方案 | A:自动索引 + 严格 CI | 闸口自动化,人聚焦语义/安全 |
| 索引同步 | PR 严格 + 合入安全网 | diff 清晰,无神秘提交 |
| 校验复用 | 镜像 3 个纯函数 | SDK 未发布,运行时兜底 |
| AI 评审 | 接入原生 Copilot + 自定义指令 | 零维护,第一道初筛 |
