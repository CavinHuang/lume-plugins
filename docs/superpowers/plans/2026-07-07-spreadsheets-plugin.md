# Lume Spreadsheets 插件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Codex `spreadsheets` 技能插件移植为 lume 市场收录的纯知识型插件 `plugins/spreadsheets/`。

**Architecture:** 纯知识型 skill 插件 —— `lume-plugin.json` 包装 + 1 个 `spreadsheets` skill（`charts.md`/`style_guidelines.md`/`domain_guidance/*` 零改动复用；`SKILL.md` 与 `routing/google_sheets.md` 重写以去除 Codex 专有依赖）。无代码、无 MCP、零 flagged 权限。

**Tech Stack:** Markdown（skill 内容）+ JSON（清单）+ Node.js（已有市场校验脚本）。

## Global Constraints

- `schema` 必须 === `"lume-plugin/v1"`；`name` = `"spreadsheets"` 必须等于目录名且匹配 `^[a-z0-9_-]{1,64}$`；`version` = `"0.1.0"` 合法 semver。
- 清单内路径以 `./` 开头、不含 `..`。
- 必须有 `LICENSE`（MIT）+ `README.md`。
- `SKILL.md` frontmatter `name` 必须 === skill 目录名 `"spreadsheets"`（小写）。
- 零 flagged 权限（不声明 shell/network/write）→ README 无需 `## 权限说明`。
- **不照搬 Codex 品牌资产**（`icon.png`/`logo.png`/`file-spreadsheet.png`）；不移植 `API_QUICK_START.md`、`agents/openai.yaml`、`.codex-plugin/`。
- 改写后的文件**不得残留** Codex 专属语法（`@oai` / `load_workspace_dependencies` / `mcp__codex_apps__` / `::codex-file-citation` / `artifact-tool` / `update_plan` / `unique_thread_id` / `workbook.<method>` 对象方法调用）。
- **Git：按用户工作习惯，本计划不含 git 提交步骤；如需提交请用户指示。**
- 参考实现根：`C:\Users\A\.codex\plugins\cache\openai-primary-runtime\spreadsheets\26.630.12135`
- 仓库根：`D:\workspace\projects\ai-projects\lume-plugins`（命令在仓库根执行）
- 测试周期 = 市场校验三件套：`npm run build:index` → `npm test` → `npm run check:index`。

## 文件结构

**创建：**
- `plugins/spreadsheets/lume-plugin.json` — 清单（schema/name/version/description/displayName/category/skills/author）
- `plugins/spreadsheets/LICENSE` — MIT，复制自 example-hello
- `plugins/spreadsheets/README.md` — 定位 + 触发词 + 用法 + clean-room 声明 + 结构
- `plugins/spreadsheets/skills/spreadsheets/SKILL.md` — **[重写]** 方法论保留，删专有契约/Codex 语法
- `plugins/spreadsheets/skills/spreadsheets/charts.md` — **[零改动复制]**
- `plugins/spreadsheets/skills/spreadsheets/style_guidelines.md` — **[零改动复制]**
- `plugins/spreadsheets/skills/spreadsheets/domain_guidance/{corporate_finance_fpa,financial_models,healthcare,marketing_advertising,scientific_research}.md` — **[零改动复制]**
- `plugins/spreadsheets/skills/spreadsheets/routing/google_sheets.md` — **[轻量改写]**

**生成（勿手改）：**
- `.lume-plugin/marketplace.json` — `build:index` 自动新增 `spreadsheets` 条目

---

### Task 1: 插件骨架（清单 + LICENSE + 完整 README）

**Files:**
- Create: `plugins/spreadsheets/lume-plugin.json`
- Create: `plugins/spreadsheets/LICENSE`
- Create: `plugins/spreadsheets/README.md`

**Interfaces:**
- Produces: 可被 `scripts/lib/build-manifest.mjs` 发现并通过校验的最小插件目录（含必要 LICENSE/README）。

- [ ] **Step 1: 创建 `lume-plugin.json`**

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

- [ ] **Step 2: 创建 `LICENSE`**

复制 `plugins/example-hello/LICENSE` → `plugins/spreadsheets/LICENSE`（MIT，内容原样不动）。

- [ ] **Step 3: 创建完整 `README.md`**

```markdown
# Spreadsheets

专业电子表格制作技能：当用户提到 Excel / CSV / xlsx / 工作簿 / 公式 / 图表 / Google Sheets / spreadsheet 时触发，提供从公式规则、数据格式、图表选择到财务建模、医疗、营销、科研等领域的方法论与最佳实践。

## 触发

在 Lume 对话中提及上述关键词自动触发，或手动输入 `$spreadsheets`。

## 内容来源（Clean-room）

本插件为 Lume 取向的 clean-room 参考，源自 Codex `spreadsheets` 插件公开文档中的通用方法论与领域最佳实践（如投行金融建模的颜色约定、科研数据可复现规范等行业通用惯例）。**不含复制自 Codex 的源代码或品牌资产**；技能的执行相关段落已为 Lume 运行时（`node_repl`）重写。

## 结构

- `skills/spreadsheets/SKILL.md` — 主技能（方法论 + 质量标准）
- `skills/spreadsheets/charts.md` — 图表选择与设计
- `skills/spreadsheets/style_guidelines.md` — 格式规范
- `skills/spreadsheets/domain_guidance/` — 5 个领域（财务 FP&A、金融建模、医疗、营销、科研），按需加载
- `skills/spreadsheets/routing/google_sheets.md` — 目标为 Google Sheet 时的处理

## 权限

本插件为纯知识型，不请求 shell / network / filesystem.write 权限。
```

- [ ] **Step 4: 校验骨架**

Run: `npm run build:index`
Expected: stdout 含 `4 plugins`（example-hello、lume-chrome、obsidian-bridge、spreadsheets）。

Run: `npm test`
Expected: 全绿（`node --test` 通过；含 build-manifest 与 audit-permissions 测试）。

Run: `npm run check:index`
Expected: `✓ marketplace.json in sync`。

> 说明：此时 `skills` 目录尚不存在，但 `build-manifest` 不校验 skills 目录是否存在（仅校验 manifest 引用路径合法）。校验通过即骨架成立。

---

### Task 2: 复制零改动内容（charts / style / domain_guidance）

**Files:**
- Create: `plugins/spreadsheets/skills/spreadsheets/charts.md`
- Create: `plugins/spreadsheets/skills/spreadsheets/style_guidelines.md`
- Create: `plugins/spreadsheets/skills/spreadsheets/domain_guidance/corporate_finance_fpa.md`
- Create: `plugins/spreadsheets/skills/spreadsheets/domain_guidance/financial_models.md`
- Create: `plugins/spreadsheets/skills/spreadsheets/domain_guidance/healthcare.md`
- Create: `plugins/spreadsheets/skills/spreadsheets/domain_guidance/marketing_advertising.md`
- Create: `plugins/spreadsheets/skills/spreadsheets/domain_guidance/scientific_research.md`

**Interfaces:**
- Consumes: 参考实现 `skills/spreadsheets/` 下的对应文件。
- Produces: 7 个原样复制的领域/格式/图表文档。

- [ ] **Step 1: 原样复制 7 个文件**

从 `<参考实现根>/skills/spreadsheets/` 复制到 `plugins/spreadsheets/skills/spreadsheets/`，保持子目录结构（`domain_guidance/`）。文件内容**不做任何修改**：

```
charts.md
style_guidelines.md
domain_guidance/corporate_finance_fpa.md
domain_guidance/financial_models.md
domain_guidance/healthcare.md
domain_guidance/marketing_advertising.md
domain_guidance/scientific_research.md
```

- [ ] **Step 2: grep 验证无 Codex 专属语法**

Run:
```bash
grep -rnE "@oai|load_workspace_dependencies|artifact[-_]tool|mcp__codex|::codex|codex-file-citation|update_plan|unique_thread_id|workbook\.(inspect|render|help|trace|exportXlsx|importXlsx)|SpreadsheetFile|FileBlob" \
  plugins/spreadsheets/skills/spreadsheets/charts.md \
  plugins/spreadsheets/skills/spreadsheets/style_guidelines.md \
  plugins/spreadsheets/skills/spreadsheets/domain_guidance
```
Expected: 无输出（退出码 1 = 无匹配）。若有个别 `workbook` 词命中，确认是普通英语"工作簿"而非 API 调用（pattern 已用 `workbook\.<method>` 精确匹配，正常不会误报）。

- [ ] **Step 3: 校验仍通过**

Run: `npm run build:index && npm test && npm run check:index`
Expected: 全绿（与 Task 1 相同；内容文件不影响 manifest 校验）。

---

### Task 3: 重写 `SKILL.md`（核心）

**Files:**
- Create: `plugins/spreadsheets/skills/spreadsheets/SKILL.md`

**Interfaces:**
- Consumes: 参考实现 `skills/spreadsheets/SKILL.md`（作为方法论基底）；本计划 §"改写映射表"。
- Produces: lume 化的 SKILL.md，frontmatter `name: spreadsheets`，无 Codex 专属语法，引用 charts/style/domain_guidance/routing（不引用 API_QUICK_START）。

- [ ] **Step 1: 读取源文件作为基底**

读 `<参考实现根>/skills/spreadsheets/SKILL.md` 全文。以下改写均基于其原章节，逐段应用映射表。

- [ ] **Step 2: 写新 `SKILL.md`（frontmatter + body）**

**2a. frontmatter（完整，`name` 小写 = 目录名）：**

```yaml
---
name: spreadsheets
description: 当用户请求创建、修改、分析、可视化电子表格文件（.xlsx/.xls/.csv/.tsv）或面向 Google Sheets 的工作簿（含公式、格式、图表、表格、重算）时使用本技能。Use for spreadsheet / Excel / CSV / workbook tasks with formulas, formatting, charts, tables, recalculation.
---
```

**2b. body 改写映射表（对源文件每个章节应用）：**

| 源章节 | 处理 |
|---|---|
| 标题 + 触发场景（四类工作） | **保留**，措辞轻调 |
| Decision Boundary（路由边界） | **保留**；Google Sheets 分支指向 `routing/google_sheets.md`（Task 4 产物） |
| Tools + Contract Requirements（`@oai/artifact-tool` 契约、`load_workspace_dependencies`、node_modules junction、bundled py/js 清单） | **整段删除**，替换为下方 2c 的「工具使用」段 |
| Final Response | **保留**；把 Codex 专属链接语法改为普通 markdown 链接（每行一个 `.xlsx` 链接） |
| Other documents（引用子文档） | **保留**；**删除对 `API_QUICK_START.md` 的引用**，仅保留 `style_guidelines.md`（REQUIRED）、`charts.md`、`domain_guidance/*` |
| Domain Requirements（按需加载 5 领域） | **保留** |
| Editing existing / screenshot recreation | **保留**；"先 render 看图" → "先打开/预览既有工作簿，匹配既有风格" |
| Handling queries | **保留** |
| Error Recovery | **保留**；"调 `workbook.help`" → "查所选库的官方文档后做最小 patch 重试" |
| **Formula Rules**（magic number 禁止、绝对/相对引用、跨表引用 `'Sheet'!A1`、helper cell） | **完整保留**（核心方法论，运行时无关） |
| Ensure formulas correct（检查清单） | **保留** |
| Data Formatting Rules（`#,##0` / `0.0%` / `yyyy-mm-dd`、标识符存文本） | **保留** |
| Quality Guidelines | **保留** |
| Completion Criteria | **保留**；`outputs/<unique_thread_id>/` → "导出 `.xlsx` 到用户指定位置" |
| Verification Rules（`workbook.inspect`/`render`/`match` 的 JS 片段） | **整段替换**为下方 2d 的「验证规则（引擎无关）」 |
| Citation Requirements | **保留**；删除 `::codex-file-citation{...}`，改为：单元格纯文本 URL / cell comment 标来源 / 专用 source 列 |
| Comment Author | **保留**（从用户信息取显示名，默认 `User`） |
| Source/PDF/Attachment Processing | **保留**；删除 bundled python/js 专有清单，改为"按需用环境可用工具解析源文件（PDF/CSV/旧表）" |

**2c. 「工具使用」段（替换原 Tools + Contract 整段）：**

```markdown
## 工具使用

在 Lume 中，优先用内置 `node_repl` 运行 JS（可用 exceljs、SheetJS 等库）或 Python（openpyxl、xlsxwriter）来创建、编辑、渲染、导出 `.xlsx`。任选环境中可用的电子表格工具，**严格遵循下方的方法论与质量标准**。本技能不绑定具体库——重点是产出的正确性、可审计性与格式一致性，而非特定 API。

工作方式：写一个可重复运行的小脚本反复 patch、重跑，不要用 heredoc 或重复构造。卡住时查阅所选库的官方文档，做最小重试；不要整表重写。
```

**2d. 「验证规则（引擎无关）」段（替换原 Verification Rules 的 `workbook.*` JS 片段）：**

```markdown
## 验证规则

交付前用所选工具完成以下检查（概念性要求，非特定 API）：

1. **检查关键范围**：读取关键单元格的值与公式，确认输入区与派生区正确、引用无误。
2. **扫描公式错误**：搜索 `#REF!`、`#DIV/0!`、`#VALUE!`、`#NAME?`、`#N/A` 等错误标记，逐一修复。
3. **视觉预览**：打开或渲染工作簿，确认布局合理、关键数字可见、标签不被裁切。
4. **导出**：导出为 `.xlsx` 到用户指定位置；导出后即定稿，不额外导出变体。
```

- [ ] **Step 3: grep 复查无 Codex 专属残留**

Run:
```bash
grep -nE "@oai|load_workspace_dependencies|artifact[-_]tool|mcp__codex|::codex|codex-file-citation|update_plan|unique_thread_id|workbook\.(inspect|render|help|trace|exportXlsx|importXlsx)|SpreadsheetFile|FileBlob|outputs/<" \
  plugins/spreadsheets/skills/spreadsheets/SKILL.md
```
Expected: 无输出（退出码 1）。若命中，回到 Step 2 清理对应段落。

- [ ] **Step 4: 校验通过**

Run: `npm run build:index && npm test && npm run check:index`
Expected: 全绿。

---

### Task 4: 改写 `routing/google_sheets.md`

**Files:**
- Create: `plugins/spreadsheets/skills/spreadsheets/routing/google_sheets.md`

**Interfaces:**
- Produces: 去除 `mcp__codex_apps__google_drive_import_spreadsheet` 依赖的 Google Sheet 路由说明，被 SKILL.md Decision Boundary 引用。

- [ ] **Step 1: 写改写版（完整内容）**

```markdown
# Google Sheets 路由

**默认**：本技能在本地制作并验证 `.xlsx`。

**目标为 Google Sheet 时**：先用本技能产出并验证 `.xlsx`，再由用户上传至 Google Sheets（File → Import → Upload），或用环境中可用的 Google 集成工具导入。不要用浏览器自动化去操作空白 Google Sheet——本地 `.xlsx` 经导入质量更可靠。

最终交付物若是 Google Sheet 链接，本地 `.xlsx` 视为构建产物。

**既有 Google Sheet 的编辑**：用环境中可用的 Google Sheets 集成工具，不走本地 `.xlsx` 流程。
```

- [ ] **Step 2: grep 复查**

Run:
```bash
grep -nE "mcp__codex|google_drive_import|load_workspace_dependencies" \
  plugins/spreadsheets/skills/spreadsheets/routing/google_sheets.md
```
Expected: 无输出（退出码 1）。

- [ ] **Step 3: 校验通过**

Run: `npm run build:index && npm test && npm run check:index`
Expected: 全绿。

---

### Task 5: 收录前最终验收

**Files:** 无修改（纯验收）。

**Interfaces:**
- Produces: 「插件可收录」的验收证据——全局无 Codex 残留、校验三件套全绿、marketplace 含 4 插件、frontmatter 命名一致。

- [ ] **Step 1: 全局 grep 复查整个插件目录**

Run:
```bash
grep -rnE "@oai|load_workspace_dependencies|artifact[-_]tool|mcp__codex|::codex|codex-file-citation|update_plan|unique_thread_id|workbook\.(inspect|render|help|trace|exportXlsx|importXlsx)|SpreadsheetFile|FileBlob|outputs/<" \
  plugins/spreadsheets
```
Expected: 无输出（退出码 1）。这是"无 Codex 专有残留"的总把关。

- [ ] **Step 2: 确认 frontmatter `name` === skill 目录名**

Run:
```bash
grep -nE "^name:" plugins/spreadsheets/skills/spreadsheets/SKILL.md
```
Expected: 输出 `name: spreadsheets`（与目录名 `skills/spreadsheets/` 一致）。

- [ ] **Step 3: 最终全量校验三件套**

Run: `npm run build:index`
Expected: `4 plugins`。

Run: `npm test`
Expected: 全绿。

Run: `npm run check:index`
Expected: `✓ marketplace.json in sync`。

- [ ] **Step 4: 确认 marketplace.json 含 spreadsheets 条目**

Run:
```bash
grep -nE '"name": "spreadsheets"|"source": "\./plugins/spreadsheets"' .lume-plugin/marketplace.json
```
Expected: 两行命中（name 与 source 各一），版本 `0.1.0`。

- [ ] **Step 5: 人工对话级抽查（可选，需 Lume 运行时）**

在 Lume 对话中输入 `$spreadsheets` 或"用 Excel 做一个费用报销模板"，确认：技能被加载、SKILL 方法论可见、按需加载某领域文件（如 `financial_models.md`）正常。若无 Lume 运行时，跳过本步，以 Step 1-4 为准。

---

## Self-Review

**1. Spec coverage（逐节对照）：**
- §1 目标/非目标 → Task 1-5 整体（纯知识型、无代码/MCP/Google API）。✓
- §3 方案选择（纯知识型）→ Global Constraints + Architecture。✓
- §4 范围（全量）→ Task 2（7 文件）+ Task 3（SKILL）。✓
- §5 目录结构 → 文件结构节。✓
- §6 改造策略 + D1/D2/D3 → Task 3（D1=2c、Verification=2d）、Task 4（D3）、API_QUICK_START 不移植（文件结构明确排除）。✓
- §7 SKILL 18 章节映射 → Task 3 Step 2b 映射表（完整复述）。✓
- §8 lume-plugin.json → Task 1 Step 1。✓
- §9 README/LICENSE/合规 → Task 1 Step 3（含 clean-room 声明）。✓
- §10 零权限 → Global Constraints + README 权限段。✓
- §11 验证收录 → Task 1/5 校验三件套。✓
- §12 风险（无悬空引用）→ Task 3 Step 3 + Task 5 Step 1 的 grep 把关。✓
- §13 工作分解 → Task 1-5 一一对应。✓

**2. Placeholder scan：** 无 TBD/TODO；每个含代码/文案的步骤均给出完整内容（lume-plugin.json、README、SKILL frontmatter、D1/Verification/routing 替换段）。SKILL body 的"保留段"指明照搬源文件对应章节（这是文档移植的正确指令，非 placeholder）。✓

**3. Type/naming 一致性：**
- `name: spreadsheets` 在 lume-plugin.json、SKILL frontmatter、目录名三处一致。✓
- `skills: ["./skills/"]` 指向 `plugins/spreadsheets/skills/`，lume 在此发现 `spreadsheets/SKILL.md`。✓
- grep pattern 在 Task 2/3/5 使用同一组 Codex 专属标记。✓
- D1=工具段(2c)、Verification 泛化(2d)、D3=routing(Task4) 与 spec 定稿 B/A/B 一致（A=删 API_QUICK_START 体现为"不移植"+"删除引用"，2b 映射表已删除该引用）。✓

无 spec 遗漏、无 placeholder、命名一致。计划可执行。
