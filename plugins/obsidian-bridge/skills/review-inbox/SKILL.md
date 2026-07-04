---
name: review-inbox
description: 扫描 memory/inbox/ 全部待沉淀条目,归纳去重,产出一份可确认清单(每条标来源/建议去向/置信度)。使用 read_palace 房间卡决定流程。
---

# review-inbox

把 inbox 里积压的候选记忆整理成一份人审清单。

## 执行步骤(严格按序)

1. **取房间卡**:调用 `read_palace { room: "review_inbox_room" }`。
2. **列 inbox**:调用 `list_notes { prefix: "memory/inbox/" }`,逐个 `read_note` 读取全部条目。
3. **按 mustRead 读上下文**:读 `vault.md`、`memory_policy.md`(理解沉淀规则)。
4. **归纳去重**:跨文件合并重复/相关条目;为每条判定:
   - **建议去向**:people / projects / wiki / 丢弃
   - **置信度**:高 / 中 / 低(依据来源笔记可靠性 + 是否与其他条目互证)
   - **来源**:inbox 文件路径
5. **输出清单**(直接呈现给用户,不写文件):

每行格式:
```
- [<去向>] <要点> | 置信度: <高/中/低> | 来源: <path>
```

## 坑 / 禁区

- **只读** inbox,不修改任何文件。
- 不要在此阶段写长期记忆(那是 apply-memory 的事,需用户确认)。
- 不确定去向的条目标「低置信度」并保留,不要擅自丢弃。
