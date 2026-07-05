---
name: digest-note
description: 消化一篇 Obsidian 笔记(或选区),提炼关键内容写入 memory/inbox/。使用 obsidian-bridge 的 read_palace 房间卡决定流程。
---

# digest-note

把一篇"死笔记"消化成待沉淀的 inbox 条目。

## 连接预检

开始前先调用 `bridge_status`。如果返回 `pairingRequired`,请向用户索要 Obsidian 插件设置页显示的配对码,然后调用 `pair_with_code`；不要要求用户在 Lume 其他地方寻找验证码输入框。

## 执行步骤(严格按序)

1. **取房间卡**:调用 `read_palace { room: "digest_note_room" }`,获得 mustRead/conditionalRead/outputLocation/pitfalls。
2. **按 mustRead 顺序读取上下文**:依次 `read_note` 读取 `profile.md` → `vault.md` → `style.md` → 用户指定的待消化笔记路径。
3. **条件读**:若笔记内容涉及人物/项目,按 `people/<key>.md`、`projects/<key>.md` 读取相关长期记忆(若存在)。
4. **消化**:综合上下文,提炼:
   - 关键事实 / 决议 / 待办
   - 涉及的人、项目、概念
   - 可沉淀的候选记忆条目(带置信度与来源笔记路径)
5. **写入输出位置**:用 `upsert_note` 写入 `memory/inbox/<YYYY-MM-DD>.md`(outputLocation 规定)。inbox 为自由写区,**不要**带 confirmed。
6. **遵守坑/禁区**:绝不直接写 `people/` `projects/`(那是 apply-memory 阶段、需用户确认的事)。

## 输出格式(inbox 文件片段)

每条候选记忆:
```
- [来源: <path>] <要点> | 置信度: 高/中/低 | 建议去向: people/projects/wiki
```

## 完成后

告知用户已写入哪篇 inbox 文件,并提示可后续用 `review-inbox`(Phase 2)汇总审核。
