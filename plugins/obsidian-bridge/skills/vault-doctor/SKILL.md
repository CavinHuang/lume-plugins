---
name: vault-doctor
description: 给整个 Vault 做体检:断链、孤儿笔记、raw/ 未消化、inbox 积压,分类产出报告并给出每类问题的下一步建议技能。只读不写。使用 read_palace 房间卡决定流程。
---

# vault-doctor

Vault 体检,定位"死数据"与结构问题。

## 执行步骤(严格按序)

1. **取房间卡**:调用 `read_palace { room: "vault_doctor_room" }`。
2. **取诊断数据**:调用 `vault_diagnostics { }`,获得 `{ brokenLinks, orphans, rawUndigested }`。
3. **补充核对**:
   - `list_notes { prefix: "raw/" }` 与 `rawUndigested` 交叉核对
   - `list_notes { prefix: "memory/inbox/" }` 统计 inbox 积压数量
4. **产出体检报告**(呈现给用户,不写文件),分类列出:

```
## 断链(N 处)
- <from.md> → <坏链接>
## 孤儿笔记(N 篇,无任何链接)
- <path>
## raw/ 未消化(N 个)
- <path>  → 建议:digest-note
## inbox 积压(N 条)
→ 建议:review-inbox → apply-memory
```

5. **下一步建议**:每类问题指明对应技能(digest-note / review-inbox / apply-memory)。

## 坑 / 禁区

- **只读不写**。
- 报告引用**具体路径**,便于用户定位。
- 不擅自修复(修复由用户触发对应技能)。
