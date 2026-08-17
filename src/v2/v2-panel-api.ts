import type { Context } from "./types"
import type { PanelApi, PanelEvent, PanelEventType } from "../panel/panel-api"

const SUBAGENT_TOOL_V2 = "subagent"

/** V2 tool metadata → V1 形状（V1 逻辑读 session_id/sessionId——双写保证命中）。 */
function normalizeMeta(meta: unknown): Record<string, unknown> {
  const m = (meta && typeof meta === "object")
    ? { ...(meta as Record<string, unknown>) }
    : {}
  if (m.sessionID !== undefined) {
    if (m.session_id === undefined) m.session_id = m.sessionID
    if (m.sessionId === undefined) m.sessionId = m.sessionID
  }
  return m
}

/** V2 content part → V1 Part 形状（scan 的 part() 消费）。 */
function toV1Part(p: Record<string, any>): Record<string, any> {
  if (p.type === "tool") {
    const st = { ...(p.state ?? {}) }
    if (st.output === undefined && Array.isArray(st.content)) {
      st.output = (st.content as Array<Record<string, any>>)
        .map((c) => c.type === "text" ? c.text : c.type === "file" ? String(c.path ?? c.filename ?? "") : JSON.stringify(c))
        .filter((t): t is string => typeof t === "string" && t.length > 0)
        .join("\n")
    }
    return { type: "tool", tool: p.tool ?? p.name, state: st, subagent_type: p.subagent_type, metadata: normalizeMeta(p.metadata) }
  }
  if (p.type === "text") return { type: "text", text: String(p.text ?? "") }
  if (p.type === "file") return { type: "file", source: p.source ?? {} }
  if (p.type === "reasoning") return { type: "reasoning", text: String(p.text ?? "") }
  return p
}

/**
 * V2 (opencode2) context → PanelApi 适配实现。
 * 数据流（功能对齐 V1）：
 * - usage：messages 反向遍历（同 V1 readSessionTokens/Cost/Model 逻辑）；todo 无 V2 对应 → undefined
 * - 事件：tool 事件 → V1 ToolPart（subagent 工具名归一化 + metadata 双写 session_id/sessionId）；
 *        execution.succeeded/failed → session.idle/error
 * - 取消：session.interrupt（V1 abort 的 V2 对应）
 * - 路由：router.navigate({type:"session"})（V1 route.navigate 的 V2 对应）
 */
export function createPanelApi(context: Context, settings: PanelApi["settings"]): PanelApi {
  const kvStore = new Map<string, [Record<string, any>, (fn: (d: Record<string, any>) => void) => Promise<void>]>()
  const messageIndex = new Map<string, Record<string, any>>()
  // 工具信息记忆（key: msgID\u0000id）：called 事件可能不带 name——input.started 时记录；
  // progress/success/failed 复用（含 input——防后续事件的空 input 覆盖 title/prompt）
  const toolInfo = new Map<string, { name?: string; input?: Record<string, unknown> }>()

  const kvGet = <T>(key: string, fallback?: T): T | undefined => {
    let entry = kvStore.get(key)
    if (!entry) {
      const created = context.storage.store<Record<string, any>>(`subagent_magazine.${key}`, {
        initial: { value: fallback },
      })
      entry = created as [Record<string, any>, (fn: (d: Record<string, any>) => void) => Promise<void>]
      kvStore.set(key, entry)
    }
    const v = entry[0].value
    return v === undefined ? fallback : (v as T)
  }
  const kvSet = (key: string, value: unknown): Promise<void> => {
    let entry = kvStore.get(key)
    if (!entry) {
      const created = context.storage.store<Record<string, any>>(`subagent_magazine.${key}`, {
        initial: { value },
      })
      entry = created as [Record<string, any>, (fn: (d: Record<string, any>) => void) => Promise<void>]
      kvStore.set(key, entry)
    }
    const [, mutate] = entry
    return mutate((d) => { d.value = value })
  }

  const isSubagentTool = (name: string | undefined): boolean =>
    name === SUBAGENT_TOOL_V2 || name === "task" || name === "delegate" || name === "call_omo_agent"

  /** V2 tool 事件 → V1 ToolPart（非 subagent 工具返回 undefined——面板只关心子代理）。
   *  识别规则（对齐 V2 官方 stream-v2.subagent.ts）：
   *  - input.started/called：工具名在 subagent 集合（subagent/task/delegate/call_omo_agent）
   *  - progress：工具名记忆（input.started/called 记录——无记录忽略，防误识别）
   *  - success/failed：metadata.sessionID 存在（subagent 工具注入子会话 ID——question 等
   *    普通工具无此字段——忽略）
   *  归一化：subagent → task（V1 SUBAGENT_TOOLS 集合命中）；subagent_type 补 input.agent
   *  （V1 逻辑读 subagent_type 显示真实 agent 名）。 */
  const toolEventToPart = (event: Record<string, any>): Record<string, any> | undefined => {
    const type = event.type as string
    const data = event.data as Record<string, any> | undefined
    if (!data) return undefined
    const key = data.assistantMessageID !== undefined ? `${String(data.assistantMessageID)}\u0000${String(data.id)}` : undefined
    const info = key ? toolInfo.get(key) : undefined
    const normName = (n: string) => (n === SUBAGENT_TOOL_V2 ? "task" : n)
    const agentOf = (input: any): string | undefined => {
      const i = (input && typeof input === "object") ? input : {}
      return typeof i.agent === "string" ? i.agent : undefined
    }
    if (type === "session.tool.input.started") {
      if (!isSubagentTool(data.name)) return undefined
      if (key) toolInfo.set(key, { name: String(data.name), input: {} })
      return { type: "tool", tool: normName(String(data.name)), id: String(data.id), state: { status: "pending", input: {} } }
    }
    if (type === "session.tool.called") {
      const name = data.name ?? info?.name
      if (name && !isSubagentTool(name)) return undefined
      if (!name) return undefined
      if (key) toolInfo.set(key, { name: String(name), input: data.input ?? {} })
      return {
        type: "tool", tool: normName(String(name)), id: String(data.id), subagent_type: agentOf(data.input),
        state: { status: "running", input: data.input ?? {}, metadata: {} },
      }
    }
    if (type === "session.tool.progress") {
      const name = data.name ?? info?.name
      if (name && !isSubagentTool(name)) return undefined
      if (!name) return undefined
      return {
        type: "tool", tool: normName(String(name)), id: String(data.id), subagent_type: agentOf(info?.input),
        state: { status: "running", input: info?.input ?? {}, metadata: normalizeMeta(data.metadata) },
      }
    }
    if (type === "session.tool.success" || type === "session.tool.failed") {
      const meta = normalizeMeta(data.metadata)
      if (meta.sessionID === undefined) return undefined
      const name = data.name ?? info?.name
      if (name && !isSubagentTool(name)) return undefined
      const input = info?.input ?? data.input ?? {}
      return {
        type: "tool", tool: normName(String(name ?? "task")), id: String(data.id), subagent_type: agentOf(input),
        state: {
          status: type === "session.tool.failed" ? "error" : "completed",
          input,
          metadata: meta,
        },
      }
    }
    return undefined
  }

  /** 消息归一化（V1 形状：role/tokens/cost/modelID）+ 建立 part 索引。 */
  const normalizeMessages = (sid: string): any[] => {
    const raw = context.data.session.message.list(sid) ?? []
    const out: any[] = []
    for (const m of raw) {
      const record = m as Record<string, any>
      messageIndex.set(String(m.id), record)
      const model = (m.model as { providerID?: string; id?: string } | undefined) ?? (typeof m.model === "string" ? { id: m.model } : undefined)
      out.push({
        ...m,
        role: m.type === "assistant" ? "assistant" : m.type === "user" ? "user" : m.type,
        modelID: model?.id,
      })
    }
    return out
  }

  return {
    kv: {
      get: kvGet,
      set: kvSet as (key: string, value: unknown) => void,
    },
    usage: {
      readSessionTokens: (sid: string): number | undefined => {
        if (!sid) return undefined
        try {
          const msgs = context.data.session.message.list(sid)
          if (msgs) {
            for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i] as Record<string, any>
              if (m.type !== "assistant") continue
              const t = m.tokens as Record<string, any> | undefined
              if (!t || !(Number(t.output) > 0)) continue
              const ctx =
                (Number(t.input) || 0) +
                (Number(t.output) || 0) +
                (Number(t.reasoning) || 0) +
                (Number(t.cache?.read) || 0) +
                (Number(t.cache?.write) || 0)
              if (ctx > 0) return ctx
            }
          }
          return undefined
        } catch { return undefined }
      },
      readSessionCost: (sid: string): number | undefined => {
        if (!sid) return undefined
        try {
          const session = context.data.session.get(sid)
          if (session?.cost != null && session.cost > 0) return session.cost
          const msgs = context.data.session.message.list(sid)
          if (!msgs) return undefined
          let total = 0
          for (const m of msgs as any[]) {
            if (m.type === "assistant" && typeof m.cost === "number") total += m.cost
          }
          return total > 0 ? total : undefined
        } catch { return undefined }
      },
      readSessionModel: (sid: string): string | undefined => {
        if (!sid) return undefined
        try {
          const msgs = context.data.session.message.list(sid)
          if (msgs) {
            for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i] as Record<string, any>
              if (m.type !== "assistant") continue
              const model = m.model as { id?: string } | string | undefined
              if (typeof model === "string") return model
              if (model?.id) return String(model.id)
            }
          }
          return undefined
        } catch { return undefined }
      },
      readSessionTodo: () => undefined, // V2 无 todo 数据源
    },
    session: {
      get: (sid) => { try { return context.data.session.get(sid) as any } catch { return undefined } },
      status: (sid) => {
        try {
          const st = context.data.session.status(sid)
          // V2 的 status 值（running/idle…）→ V1 语义（busy/idle…）：
          // V1 cancelEntry 检查 `st.type !== "busy"`（busy=运行中→走取消流程）；
          // V2 的 "running" 等价 V1 的 "busy"——不映射会跳过取消直接标记 done。
          const type = st === "running" ? "busy" : st ?? ""
          return { type }
        } catch { return undefined }
      },
      messages: (sid) => { try { return normalizeMessages(sid) } catch { return undefined } },
      part: (messageID) => {
        const msg = messageIndex.get(String(messageID))
        if (!msg) return undefined
        if (!Array.isArray(msg.content) || msg.content.length === 0) {
          if (typeof msg.text === "string" && msg.text.length > 0) {
            return [{ type: "text", text: msg.text }]
          }
          return []
        }
        return msg.content.map((p) => toV1Part(p as Record<string, any>))
      },
    },
    event: {
      on: (type: PanelEventType, cb: (e: PanelEvent) => void) => {
        switch (type) {
          case "part.updated": {
            const unsubs: Array<() => void> = []
            for (const evt of ["session.tool.input.started", "session.tool.called", "session.tool.progress", "session.tool.success", "session.tool.failed"]) {
              unsubs.push(context.data.on(evt, (e) => {
                const part = toolEventToPart((e as Record<string, any>))
                if (part) cb({ type, payload: { part } })
              }))
            }
            return () => { for (const u of unsubs) u() }
          }
          case "message.updated": {
            const unsubs: Array<() => void> = []
            for (const evt of ["session.step.started", "session.step.ended", "session.step.failed"]) {
              unsubs.push(context.data.on(evt, () => cb({ type })))
            }
            return () => { for (const u of unsubs) u() }
          }
          case "session.idle":
            return context.data.on("session.execution.succeeded", (e) => {
              const sid = String(((e as Record<string, any>).data as Record<string, any> | undefined)?.sessionID ?? "")
              if (sid) cb({ type, payload: { sessionID: sid } })
            })
          case "session.error":
            return context.data.on("session.execution.failed", (e) => {
              const evt = (e as Record<string, any>).data as Record<string, any> | undefined
              const sid = String(evt?.sessionID ?? "")
              if (sid) cb({ type, payload: { sessionID: sid, error: evt?.error } })
            })
          default:
            return () => {}
        }
      },
    },
    client: {
      abort: ({ sessionID }) => context.data.session.interrupt(sessionID),
    },
    route: {
      navigateSession: (sessionID) => context.ui.router.navigate({ type: "session", sessionID }),
    },
    ui: {
      toast: (message, opts) => context.ui.toast.show({ message, title: opts?.title, variant: opts?.variant }),
    },
    settings,
  }
}
