---
name: update-profile
description: 从 memory/feedback/ 的 👍/👎 反馈中提炼稳定模式,产出对 profile.md / style.md 的更新建议,逐条经用户确认后写入。使用 read_palace 房间卡决定流程。
---

# update-profile

让 Agent 从反馈中学习,更新画像(越用越懂你)。

## 连接预检

开始前先调用 `bridge_status`。如果返回 `pairingRequired`,请向用户索要 Obsidian 插件设置页显示的配对码,然后调用 `pair_with_code`；不要要求用户在 Lume 其他地方寻找验证码输入框。

## 执行步骤(严格按序)

1. **取房间卡**:调用 `read_palace { room: "update_profile_room" }`。
2. **按 mustRead 读上下文**:当前 `profile.md`、`style.md`。
3. **读全部反馈**:`list_notes { prefix: "memory/feedback/" }`,逐个 `read_note`。
4. **提炼稳定模式**:只在**多条反馈反复出现**时才视为稳定模式;偶发反馈忽略。例如「用户对市场推断要保持克制」。
5. **出更新建议呈现给用户**:对 profile.md / style.md 各列「将加 / 将改哪条」,**逐条确认**。
6. **执行写入**(确认后):根级画像文件写入**必须**带 `confirmed: true`。

## 坑 / 禁区

- **绝不**未确认就改 profile.md / style.md。
- 只采纳**稳定模式**(反复出现),单次反馈不构成画像更新。
- 画像文件优先追加而非重写。
