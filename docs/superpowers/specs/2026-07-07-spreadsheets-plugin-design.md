# Lume Spreadsheets 插件设计（纯知识型 · 全量对标）

- **日期**：2026-07-07
- **状态**：已批准（设计评审通过），待实现
- **作者**：Leo
- **参考实现**：`C:\Users\A\.codex\plugins\cache\openai-primary-runtime\spreadsheets\26.630.12135`（OpenAI Codex `spreadsheets` 插件，clean-room 移植）

---

## 1. 背景与目标

把 Codex 的 `spreadsheets` 技能插件移植为 lume 市场收录的**纯知识型**插件 `plugins/spreadsheets/`。Lume 用户在对话中提到 Excel / CSV / xlsx / 工作簿 / 公式 / 图表等时，获得一套专业的电子表格制作方法论与领域规范，产出结构清晰、公式可审计、格式一致的 `.xlsx`。

**目标产物**：符合 `lume-plugin/v1` schema、通过市场收录校验（`build:index` / `test` / `check:index`）的第 4 个市场插件。

**非目标（YAGNI 边界）**：
- 不打包可执行代码、不绑定具体 xlsx 库。
- 不自建 MCP server。
- 不接 Google Sheets API（无需凭证 / 网络）。
- 不提供绑定具体库的 API 速查（原 `API_QUICK_START.md` 不移植）。

执行能力交给 Lume 运行时（内置 `node_repl` 等），插件只承载**知识层**。

---

## 2. 关键事实（来自参考实现核查）

- 参考实现是**纯提示词型技能**：无代码、无 MCP server、零 npm 依赖。
- 其真实造表能力来自 **Codex 运行时专有注入**的 `@oai/artifact-tool` JS 库 + `load_workspace_dependencies` —— lume 无此机制。
- Google Sheets 能力甩给另一 Codex 插件 `google-drive@openai-curated` 的 `mcp__codex_apps__google_drive_import_spreadsheet`。
- **grep 核查结论**：`domain_guidance/*.md`、`charts.md`、`style_guidelines.md` **不含任何 Codex 专属语法或 API 调用**（命中的 `workbook` 均为普通英语"工作簿"），可零改动复用。
- Codex 专属语法（`@oai`、`load_workspace_dependencies`、`mcp__codex_apps__`、`::codex-file-citation`、`workbook.*` 对象方法、`update_plan`、`outputs/<unique_thread_id>/`、bundled py/js 清单）**仅出现**于 `SKILL.md`、`API_QUICK_START.md`、`routing/google_sheets.md`。

---

## 3. 方案选择：纯知识型

已排除三条路径：

| 方案 | 否决理由 |
|---|---|
| node_repl + 打包 JS xlsx 库（exceljs/SheetJS） | 最忠实但最重：需打包第三方库、维护、写 API 文档、验证 node_repl 能 import bundle。 |
| 本地 MCP server | lume 已内置 node_repl，再包一层是过度工程。 |
| Google Sheets API | 需凭证管理 + `network.outbound`；Codex 刻意避免；不适合精选市场轻量收录。 |

**纯知识型**最契合 lume 市场哲学：零依赖、零权限、即装即用。代价是失去"绑定具体库的精确 API 速查"，但 lume 有 node_repl，模型可自选工具，方法论足以保证产出质量。

---

## 4. 范围：全量对标

核心 SKILL（lume 化）+ `charts.md` + `style_guidelines.md` + 全部 5 个领域文件（`corporate_finance_fpa` / `financial_models` / `healthcare` / `marketing_advertising` / `scientific_research`）。约 60KB markdown，零打包依赖。SKILL 指示领域文件"只在相关时按需加载"，不增加常驻上下文。

---

## 5. 目录结构

```
plugins/spreadsheets/
├── lume-plugin.json              [新增]  schema=lume-plugin/v1
├── README.md                     [新增]  clean-room 声明 + 触发词 + 用法
├── LICENSE                       [新增]  MIT
└── skills/spreadsheets/          [结构复用]  frontmatter name 须 = 目录名
    ├── SKILL.md                  [重写]  方法论保留；删专有库契约/Codex 语法
    ├── charts.md                 [零改动复用]
    ├── style_guidelines.md       [零改动复用]
    ├── domain_guidance/          [零改动复用]
    │   ├── corporate_finance_fpa.md
    │   ├── financial_models.md
    │   ├── healthcare.md
    │   ├── marketing_advertising.md
    │   └── scientific_research.md
    └── routing/
        └── google_sheets.md      [轻量改写]  去 mcp__codex_apps__ 依赖
```

**不移植**：`API_QUICK_START.md`（绑专有库）、`agents/openai.yaml`（Codex Composer UI 元数据）、`assets/icon.png` + `logo.png` + `skills/spreadsheets/assets/file-spreadsheet.png`（OpenAI 品牌资产）、`.codex-plugin/plugin.json`（Codex 清单）。

---

## 6. 内容改造策略

| 文件 | 处理 | 细节 |
|---|---|---|
| `SKILL.md` | **重写** | 见 §7 章节级删/留清单；frontmatter `name` 改小写 = 目录名。 |
| `charts.md` | **零改动** | 纯方法论。 |
| `style_guidelines.md` | **零改动** | 纯规范。 |
| `domain_guidance/*.md`（5） | **零改动** | 纯领域知识。 |
| `API_QUICK_START.md` | **删除（不移植）** | 绑定不存在的专有库；纯知识型不需要（D2=A）。 |
| `routing/google_sheets.md` | **轻量改写** | 去 Codex 插件依赖，改为引擎无关的 Google Sheet 处理建议（D3=B）。 |
| `agents/openai.yaml` | **删除（不移植）** | Codex Composer UI 元数据，lume 不渲染。 |

### D1（定稿 = B）SKILL "工具使用"段 —— 引擎无关轻量指引

替换 Codex 的"必须用 `@oai/artifact-tool`"硬契约，改为一段引擎无关建议，**示例文案**：

> **工具使用**：在 Lume 中，优先用内置 `node_repl` 运行 JS（可用 exceljs / SheetJS 等库）或 Python（openpyxl / xlsxwriter）来创建、编辑、渲染、导出 `.xlsx`。任选环境中可用的电子表格工具，**严格遵循下方的方法论与质量标准**。本技能不绑定具体库——重点是产出的正确性、可审计性与格式一致性，而非特定 API。

### D2（定稿 = A）`API_QUICK_START.md` —— 删除

YAGNI：保留一份绑定不存在库的 25KB 速查是负担且会误导模型。SKILL 不再引用它。

### D3（定稿 = B）`routing/google_sheets.md` —— 轻量改写

去 `mcp__codex_apps__google_drive_import_spreadsheet` 依赖，**示例文案**：

> **目标为 Google Sheet 时**：先用本技能在本地制作并验证 `.xlsx`，再由用户上传至 Google Sheets（File → Import）或用环境中可用的 Google 集成工具导入。不要用浏览器自动化去操作空白 Google Sheet。最终交付物若是 Google Sheet 链接，本地 `.xlsx` 视为构建产物。

---

## 7. SKILL.md 章节级改写清单

基于 Codex `SKILL.md` 的 18 个章节，逐项标注处理：

| # | Codex 章节 | 处理 |
|---|---|---|
| 1 | 标题 + 触发场景 | 保留（措辞轻调） |
| 2 | Decision Boundary（路由边界） | 保留（Google Sheets 分支指向改写后的 `routing/google_sheets.md`） |
| 3 | Tools + Contract Requirements（`@oai/artifact-tool` 契约） | **删除 → 替换为 D1 引擎无关轻量指引** |
| 4 | Final Response | 保留（去 Codex 专属链接语法，用普通 markdown 链接） |
| 5 | Other documents（引用子文档） | 保留（**移除对 `API_QUICK_START.md` 的引用**） |
| 6 | Domain Requirements | 保留（按需加载 5 领域文件） |
| 7 | Editing existing / screenshot recreation | 保留（"先 render 看图" → "先打开/预览既有工作簿"） |
| 8 | Handling queries | 保留 |
| 9 | Error Recovery | 保留（去 `workbook.help`，改为"查所用库的文档后最小重试"） |
| 10 | **Formula Rules** | **完整保留**（核心方法论，运行时无关：magic number 禁止、绝对/相对引用、跨表引用、helper cell 等） |
| 11 | Ensure formulas correct（检查清单） | 保留 |
| 12 | Data Formatting Rules | 保留（Excel-invariant 格式码 `#,##0` / `0.0%` / `yyyy-mm-dd`） |
| 13 | Quality Guidelines | 保留 |
| 14 | Completion Criteria | 保留（去 `outputs/<thread_id>/` 专有路径，改为"导出至用户指定位置"） |
| 15 | Verification Rules（`workbook.*` JS 片段） | **泛化**（去 `workbook.inspect/render`，改为"用所选工具：检查关键范围、扫 `#REF!/#DIV/0!` 等公式错误、预览布局"） |
| 16 | Citation Requirements | 保留（去 `::codex-file-citation`，用单元格纯文本 URL / cell comment / source 列） |
| 17 | Comment Author | 保留（从用户信息取显示名，默认 `User`） |
| 18 | Source/PDF/Attachment Processing | 保留（去 bundled py/js 专有清单，改为通用"按需用可用工具解析源文件"） |

**frontmatter**：
```yaml
---
name: spreadsheets
description: 当用户请求创建、修改、分析、可视化电子表格文件（.xlsx/.xls/.csv/.tsv）或面向 Google Sheets 的工作簿（含公式、格式、图表、表格、重算）时使用本技能。Use for spreadsheet / Excel / CSV / workbook tasks with formulas, formatting, charts, tables, recalculation.
---
```
（中英混合描述，兼顾中英 query 触发；`name` 小写 = 目录名 `spreadsheets`。）

---

## 8. `lume-plugin.json` 规格

```json
{
  "schema": "lume-plugin/v1",
  "name": "spreadsheets",
  "version": "0.1.0",
  "description": "专业电子表格制作方法论与领域规范:公式/格式/图表/数据完整性的最佳实践,覆盖财务建模、医疗、营销、科研等场景。触发词:Excel/CSV/xlsx/工作簿/公式/图表/spreadsheet。",
  "author": "CavinHuang",
  "displayName": "Spreadsheets",
  "category": "Productivity",
  "skills": ["./skills/"]
}
```

- `name` = 目录名（`spreadsheets`），符合 `^[a-z0-9_-]{1,64}$`。
- 无 `hooks` / `mcpServers` / `permissions`（纯知识型，零 flagged 权限）。
- `category` 为自由字符串（市场索引不校验），取 `Productivity` 贴 Codex 原版。

---

## 9. README / LICENSE / 合规

### README.md
- 插件一句话定位 + 触发关键词清单（Excel/CSV/xlsx/工作簿/公式/图表/Google Sheets/spreadsheet）。
- 用法：在 Lume 对话中提及上述关键词自动触发，或手动 `$spreadsheets`。
- **内容来源声明**（clean-room，沿用 lume-chrome 措辞）：本插件为 Lume 取向的 clean-room 参考，源自 Codex `spreadsheets` 插件公开文档的通用方法论与领域最佳实践；**不含复制自 Codex 的源代码或品牌资产**。领域知识（如金融建模颜色约定）属行业通用惯例。
- 不含 `## 权限说明`（无 flagged 权限）。

### LICENSE
MIT（与其他插件一致）。

### 合规边界
- 领域文件 / charts / style：通用最佳实践，自由采用。
- **不照搬** Codex 品牌图标（icon.png / logo.png / file-spreadsheet.png）。首版不附图标（YAGNI；纯知识型无需品牌资产）。
- SKILL 执行段（§7 第 3、15 项）用自己的话重写，不照搬 Codex 专有契约。

---

## 10. 权限

**零 flagged 权限**：
- 不执行代码 → 无 `shell` / `node_repl` 声明。
- 不联网 → 无 `network.outbound`。
- 不写文件系统（插件自身） → 无 `filesystem.write`。
- skill 文件由 lume 加载机制读取，无需显式 `filesystem.read`。

→ `auditPermissions` 直接通过；README 无需 `## 权限说明`。

---

## 11. 验证与收录流程

1. **本地预检**（根目录）：
   - `npm run build:index` —— 重建 `.lume-plugin/marketplace.json`，应自动新增第 4 个插件条目 `spreadsheets`。
   - `npm test` —— manifest 校验（`build-manifest.mjs` + 权限审计）。
   - `npm run check:index` —— 索引与目录同步。
2. **校验要点**：
   - `schema` === `lume-plugin/v1`；`name` === 目录名；`version` 合法 semver。
   - `LICENSE` + `README.md` 存在。
   - skills 路径 `./skills/` 通过 `validatePluginPath`（相对、`./` 开头、无 `..`）。
   - frontmatter `name` === skill 目录名（`spreadsheets`）。
3. **功能验证**（人工 / 对话内）：
   - skill 被 lume 发现并加载。
   - 关键词（Excel / CSV / xlsx / 工作簿 / 公式）触发命中。
   - 按需加载领域文件正常。
4. **PR**：套用 `.github/PULL_REQUEST_TEMPLATE.md` 自查清单，一个插件一个 PR。

---

## 12. 风险与注意事项

- **SKILL 改写质量**是核心风险：删专有库契约后，方法论段必须自洽（不能残留对已删 API 的引用）。改写后需通读确认无悬空引用（`workbook.`、`@oai`、`artifact-tool`、`load_workspace_dependencies`、`::codex`、`update_plan`、`outputs/<`）。
- **触发率**：纯知识型靠 description 关键词路由，需保证 description 关键词密集（中英双覆盖）。
- **合规**：严格不照搬 Codex 品牌资产；README clean-room 声明必备。
- **后续演进**：若日后要"真实造表执行能力"，可另起 `spreadsheets-builder` 插件走 node_repl + 打包库路线，与本知识型插件解耦（不污染本插件的最小权限定位）。

---

## 13. 实现工作分解（供 writing-plans 输入）

1. 复制 `plugins/example-hello/` 为 `plugins/spreadsheets/` 模板，清理示例 skills/hooks/mcp。
2. 新建 `plugins/spreadsheets/skills/spreadsheets/`，从参考实现**原样复制** `charts.md`、`style_guidelines.md`、`domain_guidance/*.md`。
3. **改写** `SKILL.md`（按 §7 清单）与 `routing/google_sheets.md`（按 D3）。
4. **不复制** `API_QUICK_START.md`、`agents/`、`assets/`、`.codex-plugin/`。
5. 写 `lume-plugin.json`（§8）、`README.md`（§9）、`LICENSE`（MIT）。
6. 根目录跑 `npm run build:index && npm test && npm run check:index`，三项全绿。
7. grep 复查改写后的 SKILL/routing 无 Codex 专属语法残留。
