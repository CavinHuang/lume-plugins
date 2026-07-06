# Obsidian Bridge 配对界面设计

Status: 方案 1 已确认，等待规格审阅后进入实现计划
Date: 2026-07-06

## 背景

Obsidian Bridge 当前设置页只渲染：

```text
Obsidian Bridge
配对码(10 分钟内有效;重新生成请禁用再启用本插件):
<pre>123456</pre>
```

这个界面有两个直接问题：

1. 验证码视觉层级弱，像调试输出，不像面向用户的配对操作。
2. 不支持复制，用户需要手动选中验证码，容易选漏或复制多余字符。

配对流程已经确定为：Obsidian 生成配对码，用户把配对码发给 Lume 对话，Agent 调用 `pair_with_code` 完成绑定。此次只优化 Obsidian 设置页，不改 MCP 协议、不改 token 存储、不改 Lume 对话流程。

## 目标

- 设置页看起来像一个明确的连接面板，而不是 raw debug 输出。
- 验证码要大、清晰、易读，适合短时间人工转交。
- 提供“复制”按钮，复制成功后给 Obsidian Notice 反馈。
- 提供“重新生成配对码”按钮，不再提示用户禁用再启用插件。
- 显示本地桥接服务状态信息，至少包括运行端口。
- 使用 Obsidian 原生 `PluginSettingTab`、`Notice` 和 DOM API，不新增依赖。

## 非目标

- 不实现二维码。
- 不持久化配对码。
- 不显示或复制 token。
- 不修改 `/pair`、MCP `pair_with_code` 或 Lume 插件详情页。
- 不做完整 Obsidian 主题系统，只使用能适配明暗主题的 CSS 变量。

## 设计

设置页采用单卡片布局：

```text
Obsidian Bridge
让 Lume 安全连接当前 Vault。

┌──────────────────────────────────────────────┐
│ 状态                                         │
│ ● 本地服务运行中  127.0.0.1:43112            │
│                                              │
│ 配对码                                       │
│ ┌────────────────────────────┐  [复制]       │
│ │          123 456           │               │
│ └────────────────────────────┘               │
│ 10 分钟内有效。复制后回到 Lume 对话发送。      │
│                                              │
│ [重新生成配对码]                              │
└──────────────────────────────────────────────┘
```

### 视觉规则

- 页面标题使用 `h2`，副标题使用普通说明文字。
- 主体卡片使用 Obsidian 变量：
  - `var(--background-secondary)` 作为卡片背景。
  - `var(--background-primary)` 作为验证码框背景。
  - `var(--background-modifier-border)` 作为边框。
  - `var(--text-accent)` 用于状态点和主要按钮强调。
- 验证码显示为等宽、加粗、较大字号，并按三位分组显示，例如 `123 456`。
- 复制按钮靠近验证码，避免用户不知道按钮作用域。
- 重新生成按钮放在说明下方，作为次要动作。

### 交互规则

#### 复制

点击“复制”：

1. 复制原始验证码字符串，不包含空格分组。
2. 成功后显示 `Notice("配对码已复制")`。
3. 按钮短暂显示“已复制”。
4. 如果 `navigator.clipboard.writeText` 不可用，使用临时 `textarea` fallback。
5. fallback 失败时显示 `Notice("复制失败，请手动复制配对码")`。

#### 重新生成

点击“重新生成配对码”：

1. 调用 `pairing.generateCode()`。
2. 更新 `plugin.pairingCode`。
3. 重新渲染设置页。
4. 显示 `Notice("已生成新的配对码")`。

重新生成不会重启本地 server。旧验证码仍由 `PairingStore` 的现有逻辑决定是否失效；当前实现中 `generateCode()` 会覆盖旧 code。

## 代码结构

修改 `plugins/obsidian-bridge/src/obsidian-app/main.ts`：

- 从 `obsidian` 增加导入 `Notice`。
- 在 `ObsidianBridgePlugin` 增加方法：

```ts
regeneratePairingCode(): string
```

该方法调用内部 `pairing.generateCode()`，更新 `pairingCode` 并返回新 code。

- 在 `BridgeSettingTab` 内拆出小函数：

```ts
private renderPairingPanel(containerEl: HTMLElement): void
private renderCodeRow(parent: HTMLElement, code: string): void
private async copyPairingCode(code: string, button: HTMLButtonElement): Promise<void>
```

这些函数只服务当前设置页，不抽到新文件，保持 diff 小。

## 测试策略

Obsidian 设置页依赖 Obsidian DOM API，现有测试主要覆盖协议、router、MCP 和 pairing store。此次 UI 改动以构建验证为主：

- 运行 `npm run build:obsidian`，确保 Obsidian bundle 可构建。
- 如修改配对 store 行为，则运行 `npm test -- --test-name-pattern "pairing"`；本次不改 store 行为，通常不需要新增测试。

## 错误处理

- 如果 `this.plugin.pairingCode` 为空，验证码框显示 `—`，复制按钮 disabled。
- 如果复制失败，显示 Notice 并保留当前界面。
- 如果重新生成失败，显示错误 Notice；当前 `generateCode()` 同步且不预期失败，不添加过度防御。

## 自检

- 设计只改 Obsidian 设置页 UI，不改配对协议。
- 复制内容明确为无空格原始验证码。
- 重新生成路径不再要求禁用再启用插件。
- 没有新依赖。
- 没有引入 token 展示或 token 复制风险。
