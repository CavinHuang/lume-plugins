export const DEFAULT_PORT = 43112;

const DIGEST_ROOM_MD = `# digest_note_room

## 触发场景
用户请求消化一篇笔记(或选区)时进入此房间。

## 必读(按顺序)
- profile.md
- vault.md
- style.md
- <当前待消化笔记>

## 条件读
- 涉及人:people/<谁>.md
- 涉及项目:projects/<什么>.md

## 输出位置
memory/inbox/<YYYY-MM-DD>.md

## 坑 / 禁区
- 不要直接写 people/ 或 projects/(需走确认门)
- inbox 文件可自由写,不弹确认
`;

const REVIEW_INBOX_ROOM_MD = `# review_inbox_room

## 触发场景
用户请求审核 memory/inbox/ 待沉淀条目时进入此房间。

## 必读(按顺序)
- vault.md
- memory_policy.md
- 用 list_notes 列出 memory/inbox/ 全部文件

## 条件读
- 条目涉及人:people/<谁>.md(若存在)
- 条目涉及项目:projects/<什么>.md(若存在)

## 输出位置
向用户输出「可确认清单」(不写文件):每条含来源、建议去向(people/projects/wiki/丢弃)、置信度。

## 坑 / 禁区
- 只读 inbox,不修改 inbox 文件
- 不要在此阶段写长期记忆(交给 apply-memory)
`;

const APPLY_MEMORY_ROOM_MD = `# apply_memory_room

## 触发场景
用户确认 review-inbox 的清单后,把条目沉淀到长期记忆时进入此房间。

## 必读(按顺序)
- profile.md
- vault.md
- 用户确认的清单

## 条件读
- 目标人物:people/<谁>.md(若已存在,需合并而非覆盖)
- 目标项目:projects/<什么>.md(同上)

## 输出位置
people/ 、projects/ 、wiki/ 下对应文件(长期记忆区)。

## 坑 / 禁区
- 长期记忆区写入必须带 confirmed=true(走确认门)
- 已存在文件优先追加,避免覆盖历史
`;

const UPDATE_PROFILE_ROOM_MD = `# update_profile_room

## 触发场景
用户请求从 memory/feedback/ 反馈中学习、更新画像时进入此房间。

## 必读(按顺序)
- profile.md
- style.md
- 用 list_notes 列出 memory/feedback/ 全部文件并逐条读取

## 条件读
- 无

## 输出位置
profile.md 、style.md(根级画像文件)。

## 坑 / 禁区
- 写入必须带 confirmed=true
- 只提炼稳定模式,忽略偶发反馈;每次更新逐条让用户确认
`;

const VAULT_DOCTOR_ROOM_MD = `# vault_doctor_room

## 触发场景
用户请求给 Vault 做体检时进入此房间。

## 必读(按顺序)
- vault.md
- 调用 vault_diagnostics 取断链/孤儿/raw 未消化

## 条件读
- 用 list_notes 列 raw/ 核对未消化清单
- 用 list_notes 列 memory/inbox/ 核对积压

## 输出位置
向用户输出体检报告(不写文件):分类列出问题 + 每类的下一步建议技能。

## 坑 / 禁区
- 只读不写
- 报告里引用具体路径,便于用户定位
`;

export const PALACE_ROOMS: { path: string; md: string }[] = [
  { path: "palace/digest_note_room.md", md: DIGEST_ROOM_MD },
  { path: "palace/review_inbox_room.md", md: REVIEW_INBOX_ROOM_MD },
  { path: "palace/apply_memory_room.md", md: APPLY_MEMORY_ROOM_MD },
  { path: "palace/update_profile_room.md", md: UPDATE_PROFILE_ROOM_MD },
  { path: "palace/vault_doctor_room.md", md: VAULT_DOCTOR_ROOM_MD },
];

export async function ensurePalaceRooms(app: import("obsidian").App): Promise<void> {
  for (const room of PALACE_ROOMS) {
    if (app.vault.getAbstractFileByPath(room.path)) continue;
    try {
      await app.vault.create(room.path, room.md);
    } catch {
      /* 已存在并发创建 */
    }
  }
}
