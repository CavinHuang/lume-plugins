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
