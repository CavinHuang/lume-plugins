---
name: apply-memory
description: 把用户已确认的 review-inbox 清单沉淀到长期记忆区(people/projects/wiki)。写入走确认门(先出计划,用户逐条确认)。使用 read_palace 房间卡决定流程。
---

# apply-memory

把确认过的清单条目合并进长期记忆。

## 执行步骤(严格按序)

1. **取房间卡**:调用 `read_palace { room: "apply_memory_room" }`。
2. **按 mustRead 读上下文**:`profile.md`、`vault.md`、用户确认的清单。
3. **合并计划**(先计划后执行):对每条清单条目,先读目标文件(若存在):
   - 已存在 → 计划 PATCH 追加(不覆盖历史)
   - 不存在 → 计划新建
4. **出合并计划呈现给用户**:列出「将新建 X / 将追加 Y / 各加什么内容」,**等用户逐条确认**。
5. **执行写入**(每条用户确认后):
   - 长期记忆区(people/ projects/ wiki/)写入**必须**带 `confirmed: true`(`upsert_note` 的确认门)
   - 已存在文件用追加方式(先读全文 → 拼接 → 写回),保留原内容

## 坑 / 禁区

- **绝不**未确认就写长期记忆区——必须 `confirmed: true`。
- 已存在文件**优先追加**,避免抹掉用户手写的历史。
- 不动 raw/、不动 inbox/(inbox 清理由用户后续手动或单独技能)。
