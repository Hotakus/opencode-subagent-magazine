# Bug: 子 agent model 字段显示为主 agent 的模型

## 现象

侧边栏子 agent 条目的 `model` 字段显示为主 agent 的模型（如 `flash`），而非子 agent 实际使用的模型（如 `deepseekpro`）。

Ctrl+X Down 进入子 agent 详情界面时，可以看到子 agent 实际使用的模型。

## 已尝试的方案

### 1. `part.model`（SubtaskPart 的 model 字段）

```ts
const pm = part.model
if (pm) model = pm.modelID
```

**结果**：`part.model` 在 runtime 可能不存在或值为主 agent 模型。

### 2. `props.api.state.session.get(subSessionID)?.model?.id`

```ts
const s = props.api.state.session.get(subSid)
const mid = s?.model?.id
```

**结果**：返回 `undefined` 或无 model 字段。

### 3. 子 agent session 消息中的 `modelID`

```ts
const subMsgs = props.api.state.session.messages(subSid)
for (const m of subMsgs) {
  const mid = m.modelID ?? m.model?.modelID ?? m.model?.id
}
```

**结果**：子 agent session 消息可能未包含 modelID，或 `api.state.session.messages(subSessionID)` 对子 agent session 不可用。

### 4. 父消息的 `modelID`（visual-cache 模式）

```ts
const msg = parentMsgs.find(m => m.id === msgID)
const mid = msg.modelID
```

**结果**：显示主 agent 的模型（父消息属于主 agent）。

### 5. `session.idle` 时从 session/messages 回填

在 `handleSessionEnd` 中读取 session 或 messages 的 model，回填到条目。

**结果**：`session.idle` 事件的 `sessionID` 与条目的 `sessionId`（来自 `part.sessionID`）匹配失败，或读取的 session/messages 不包含 model 信息。

## 客观事实

- `SubtaskPart` SDK 类型定义包含 `model?: { providerID: string; modelID: string }`，但 runtime 该字段可能不存在或被填充为主 agent 的模型。
- `api.state.session.get(subAgentSessionID)` 不返回子 agent session 的 model。
- `api.state.session.messages(subAgentSessionID)` 对子 agent session 的可用性未验证。
- 进入子 agent 详情界面（Ctrl+X Down）时系统能正确显示子 agent 模型，说明模型信息存在于系统的某个 API 或状态中。
- 该信息的获取路径与插件当前使用的 API 不同。
