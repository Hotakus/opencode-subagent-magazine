import type { Context } from "./types"
import type { PanelApi, PanelEvent, PanelEventType } from "../panel/panel-api"
import { SETTING_KEYS } from "../core/kv"
import { createSessionDbIndex, statusOfChild } from "./db"

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

/** 从 host 的 model 字段（字符串或 { id } 对象）提取模型 id。 */
function modelIdOf(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id
    if (id !== undefined) return String(id)
  }
  return undefined
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
    // TUI 数据层把子代理 metadata 放在 part 级，旧缓存形状可能嵌在 state 里——两处合并后再双写。
    const meta = normalizeMeta({
      ...(((st as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>),
      ...((p.metadata ?? {}) as Record<string, unknown>),
    })
    return { type: "tool", id: p.id, tool: p.tool ?? p.name, state: st, subagent_type: p.subagent_type, metadata: meta }
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
  // 原子 read-modify-write：宿主在存储锁内基于最新磁盘值
  // 应用 updater，因此并发 TUI 实例会 merge，
  // 而不是用过期快照互相覆盖。
  const kvUpdate = (key: string, updater: (current: unknown) => unknown): Promise<void> => {
    let entry = kvStore.get(key)
    if (!entry) {
      const created = context.storage.store<Record<string, any>>(`subagent_magazine.${key}`, {
        initial: { value: undefined },
      })
      entry = created as [Record<string, any>, (fn: (d: Record<string, any>) => void) => Promise<void>]
      kvStore.set(key, entry)
    }
    const [, mutate] = entry
    return mutate((d) => { d.value = updater(d.value) })
  }

  // 本地 opencode.db 索引：补全前台子代理缺失的 sessionId 与用量字段。
  // 数据库不可用、库结构不符或设置项 dbSync 关闭时静默禁用（回退宿主 API）。
  const dbIndex = createSessionDbIndex(() => kvGet<boolean>(SETTING_KEYS.dbSync, true) !== false)

  /** 事件 metadata 缺少子会话 id 时用本地库按 call id 回填（前台/后台通用）。 */
  const withResolvedSid = (data: Record<string, any>, meta: Record<string, unknown>): Record<string, unknown> => {
    if (meta.sessionID !== undefined) return meta
    try {
      const parent = data.sessionID !== undefined ? String(data.sessionID) : ""
      const callId = data.id !== undefined ? String(data.id) : ""
      const sid = parent && callId ? dbIndex?.resolveCall(parent, callId) : undefined
      if (sid) return normalizeMeta({ ...meta, sessionID: sid })
    } catch {}
    return meta
  }

  const isSubagentTool = (name: string | undefined): boolean =>
    name === SUBAGENT_TOOL_V2 || name === "task" || name === "delegate" || name === "call_omo_agent"

  /** 事件未携带工具名/input 时，从宿主消息缓存中恢复。
   *  V2 的 called/progress/success 事件没有 `name`，且
   *  input.started 可能被错过（TUI 启动、插件重载、流抖动）——
   *  没有这个回退，运行中的子代理要到完成时才会出现。 */
  const findToolPart = (data: Record<string, any>): { name?: string; input?: Record<string, unknown> } | undefined => {
    const sid = data.sessionID
    const msgID = data.assistantMessageID
    const partID = data.id
    if (sid === undefined || msgID === undefined || partID === undefined) return undefined
    try {
      const raw = context.data.session.message.list(String(sid))
      if (!raw) return undefined
      for (let i = raw.length - 1; i >= 0; i--) {
        const m = raw[i] as Record<string, any>
        if (!m || String(m.id) !== String(msgID)) continue
        const content = Array.isArray(m.content) ? m.content : []
        for (const p of content) {
          const pp = p as Record<string, any>
          if (pp && pp.type === "tool" && String(pp.id) === String(partID)) {
            const st = (pp.state ?? {}) as Record<string, any>
            const input = (st.input && typeof st.input === "object") ? st.input as Record<string, unknown> : undefined
            const name = pp.name ?? pp.tool
            return { name: name !== undefined ? String(name) : undefined, input }
          }
        }
        break
      }
    } catch {}
    return undefined
  }

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
      let name: string | undefined = data.name ?? info?.name
      let input: Record<string, unknown> | undefined =
        (data.input as Record<string, unknown> | undefined) ?? info?.input
      if (!name) {
        const resolved = findToolPart(data)
        if (resolved?.name) {
          name = resolved.name
          if (input === undefined) input = resolved.input
        }
      }
      if (name && !isSubagentTool(name)) return undefined
      if (!name) return undefined
      if (key) toolInfo.set(key, { name: String(name), input: input ?? {} })
      return {
        type: "tool", tool: normName(String(name)), id: String(data.id), subagent_type: agentOf(input),
        state: { status: "running", input: input ?? {}, metadata: withResolvedSid(data, {}) },
      }
    }
    if (type === "session.tool.progress") {
      let name: string | undefined = data.name ?? info?.name
      if (!name) name = findToolPart(data)?.name
      if (name && !isSubagentTool(name)) return undefined
      if (!name) return undefined
      return {
        type: "tool", tool: normName(String(name)), id: String(data.id), subagent_type: agentOf(info?.input),
        state: { status: "running", input: info?.input ?? {}, metadata: withResolvedSid(data, normalizeMeta(data.metadata)) },
      }
    }
    if (type === "session.tool.success" || type === "session.tool.failed") {
      const eventMeta = normalizeMeta(data.metadata)
      const meta = withResolvedSid(data, eventMeta)
      // 取消导致的工具失败：metadata.status 是工具被打断时的状态（"running"）——不是真错误。
      // 忽略——最终状态由 execution.interrupted → settleOnIdle 裁定 cancelled
      // （否则 handlePartUpdated 的 error 分支会把 cancel_requested 覆盖成 error）
      if (type === "session.tool.failed" && meta.status === "running") return undefined
      let name: string | undefined = data.name ?? info?.name
      let input: Record<string, unknown> | undefined =
        info?.input ?? (data.input as Record<string, unknown> | undefined)
      if (!name || input === undefined) {
        const resolved = findToolPart(data)
        if (!name && resolved?.name) name = resolved.name
        if (input === undefined && resolved?.input) input = resolved.input
      }
      if (name && !isSubagentTool(name)) return undefined
      if (key && name) toolInfo.set(key, { name: String(name), input: input ?? info?.input ?? {} })
      const finalInput = input ?? {}
      // 后台任务缺少子会话 metadata 时无法判定终态，交给扫描/轮询兜底；
      // 前台任务没有 sessionID 也必须回传 completed，否则条目会一直停在 running。
      if (meta.sessionID === undefined && (finalInput.background === true || finalInput.run_in_background === true)) {
        return undefined
      }
      // sid 来自本地库（事件没带）时以库里的 time_idle 为准：库里会话仍在运行
      // 就不提前收尾，交给周期性 reconcile 按真实状态落定（无时间阈值猜测）。
      let status: "completed" | "error" | "running" = type === "session.tool.failed" ? "error" : "completed"
      if (meta.sessionID !== undefined && meta.sessionID !== eventMeta.sessionID) {
        try {
          const childInfo = dbIndex?.info(String(meta.sessionID))
          if (childInfo && statusOfChild(childInfo) === undefined) status = "running"
        } catch {}
      }
      return {
        type: "tool", tool: normName(String(name ?? "task")), id: String(data.id), subagent_type: agentOf(finalInput),
        state: {
          status,
          input: finalInput,
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

  // ── usage enrichment（用量补全）──
  // TUI 数据层只为已加载的会话缓存 messages。从 KV 恢复的
  // 子会话通常没有缓存，因此读取依次回退到
  // 会话级聚合值、最后是（限流的）message sync——
  // 结果写入本地缓存，供面板的周期性 enrichment 读取。
  const usageCache = new Map<string, { tokens?: number; cost?: number; model?: string; at: number }>()
  const syncRequestedAt = new Map<string, number>()
  const USAGE_CACHE_TTL_MS = 5000
  const SYNC_THROTTLE_MS = 30000

  const rememberUsage = (sid: string, patch: { tokens?: number; cost?: number; model?: string }) => {
    const prev = usageCache.get(sid)
    usageCache.set(sid, { ...prev, ...patch, at: Date.now() })
  }

  const cachedUsage = (sid: string) => {
    const hit = usageCache.get(sid)
    if (!hit) return undefined
    if (Date.now() - hit.at > USAGE_CACHE_TTL_MS) return undefined
    return hit
  }

  const requestMessageSync = (sid: string) => {
    const last = syncRequestedAt.get(sid) ?? 0
    if (Date.now() - last < SYNC_THROTTLE_MS) return
    syncRequestedAt.set(sid, Date.now())
    try {
      const sync = context.data.session.message.sync
      if (typeof sync === "function") void sync.call(context.data.session.message, sid).catch(() => {})
    } catch {}
  }

  const listedSession = (sid: string) => {
    try { return context.data.session.list()?.find((s) => s.id === sid) } catch { return undefined }
  }

  return {
    kv: {
      get: kvGet,
      set: kvSet as (key: string, value: unknown) => void,
      update: kvUpdate,
    },
    usage: {
      readSessionTokens: (sid: string): number | undefined => {
        if (!sid) return undefined
        // 本地库优先：宿主数据层缺少该子会话缓存时也能给出用量。
        try {
          const dbTokens = dbIndex?.info(sid)?.tokens
          if (dbTokens !== undefined) { rememberUsage(sid, { tokens: dbTokens }); return dbTokens }
        } catch {}
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
              if (ctx > 0) { rememberUsage(sid, { tokens: ctx }); return ctx }
            }
          }
          // 本地无消息（子会话尚未加载）：使用最近同步的值，
          // 否则请数据层同步，稍后重试。
          const cached = cachedUsage(sid)?.tokens
          if (cached !== undefined) return cached
          requestMessageSync(sid)
          return undefined
        } catch { return undefined }
      },
      readSessionCost: (sid: string): number | undefined => {
        if (!sid) return undefined
        try {
          const dbCost = dbIndex?.info(sid)?.cost
          if (dbCost !== undefined) { rememberUsage(sid, { cost: dbCost }); return dbCost }
        } catch {}
        try {
          const direct = context.data.session.cost(sid)
          if (typeof direct === "number" && direct > 0) { rememberUsage(sid, { cost: direct }); return direct }
        } catch {}
        try {
          const session = context.data.session.get(sid)
          if (session?.cost != null && session.cost > 0) { rememberUsage(sid, { cost: session.cost }); return session.cost }
          const listed = listedSession(sid)
          if (listed?.cost != null && listed.cost > 0) { rememberUsage(sid, { cost: listed.cost }); return listed.cost }
          const msgs = context.data.session.message.list(sid)
          if (Array.isArray(msgs) && msgs.length > 0) {
            let total = 0
            let sawAssistant = false
            for (const m of msgs as any[]) {
              if (m.type !== "assistant") continue
              sawAssistant = true
              if (typeof m.cost === "number") total += m.cost
            }
            // 已加载的历史是权威来源：assistant 消息 cost 为 0 表示
            // 该会话确实免费（如 budget/test 模型），而非未知。
            if (sawAssistant) { rememberUsage(sid, { cost: total }); return total }
          }
          const cached = cachedUsage(sid)?.cost
          if (cached !== undefined) return cached
          requestMessageSync(sid)
          return undefined
        } catch { return undefined }
      },
      readSessionModel: (sid: string): string | undefined => {
        if (!sid) return undefined
        try {
          const dbModel = dbIndex?.info(sid)?.model
          if (dbModel !== undefined) { rememberUsage(sid, { model: dbModel }); return dbModel }
        } catch {}
        try {
          const msgs = context.data.session.message.list(sid)
          if (msgs) {
            for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i] as Record<string, any>
              if (m.type !== "assistant") continue
              const id = modelIdOf(m.model)
              if (id) { rememberUsage(sid, { model: id }); return id }
            }
          }
          const sessionModel = modelIdOf(context.data.session.get(sid)?.model)
          if (sessionModel) { rememberUsage(sid, { model: sessionModel }); return sessionModel }
          const listedModel = modelIdOf(listedSession(sid)?.model)
          if (listedModel) { rememberUsage(sid, { model: listedModel }); return listedModel }
          const cached = cachedUsage(sid)?.model
          if (cached !== undefined) return cached
          requestMessageSync(sid)
          return undefined
        } catch { return undefined }
      },
      readSessionTodo: () => undefined, // V2 无 todo 数据源
    },
    session: {
      get: (sid) => {
        try {
          const direct = context.data.session.get(sid)
          if (direct) return direct as any
          // 较旧的子会话可能未注入本地缓存；回退到
          // 会话列表，保证基于 parentID 的路由继续工作。
          const list = context.data.session.list?.()
          if (Array.isArray(list)) {
            const found = list.find((s) => (s as any)?.id === sid)
            if (found) return found as any
          }
          return undefined
        } catch { return undefined }
      },
      status: (sid) => {
        try {
          const st = context.data.session.status(sid)
          if (st) {
            // V2 的 "running" 等价 V1 的 "busy"（cancelEntry 检查 `st.type !== "busy"`——
            // 不映射会跳过取消流程直接标记 done）
            const type = st === "running" ? "busy" : st
            return { type }
          }
        } catch {}
        // 宿主没有该子会话的实时状态（未加载缓存）时用本地库终态兜底：
        // time_idle 存在即已结束；不存在则不猜测（交给事件/扫描）。
        try {
          if (statusOfChild(dbIndex?.info(sid)) !== undefined) return { type: "idle" }
        } catch {}
        return undefined
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
      resolveChild: (input) => {
        try {
          const sid = input.callId ? dbIndex?.resolveCall(input.parentId, input.callId) : undefined
          if (sid) return sid
          return dbIndex?.matchChild(input.parentId, input.agent, input.startedAt)
        } catch { return undefined }
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
                const evtData = (e as Record<string, any>).data as Record<string, any> | undefined
                if (!part) {
                  return
                }
                // V2 事件流是全局的（跨所有会话）；把发起会话 ID 一并传给面板，
                // 让面板只归账到正在查看的会话（V1 宿主已按会话 scope，无需该字段）。
                const sid = evtData?.sessionID !== undefined ? String(evtData.sessionID) : undefined
                if (!sid) return
                cb({ type, scope: "global", payload: { part, sessionID: sid } })
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
          case "session.idle": {
            // V1 的 session.idle = 会话结束（含取消后的 idle——settleOnIdle 裁定 cancelled）
            // V2：execution.succeeded（正常完成）+ execution.interrupted（被中断——取消）都映射到这里
            const unsubs: Array<() => void> = []
            for (const evt of ["session.execution.succeeded", "session.execution.interrupted"]) {
              unsubs.push(context.data.on(evt, (e) => {
                const sid = String(((e as Record<string, any>).data as Record<string, any> | undefined)?.sessionID ?? "")
                if (sid) cb({ type, scope: "global", payload: { sessionID: sid } })
              }))
            }
            return () => { for (const u of unsubs) u() }
          }
          case "session.error":
            return context.data.on("session.execution.failed", (e) => {
              const evt = (e as Record<string, any>).data as Record<string, any> | undefined
              const sid = String(evt?.sessionID ?? "")
              if (sid) cb({ type, scope: "global", payload: { sessionID: sid, error: evt?.error } })
            })
          default:
            return () => {}
        }
      },
    },
    client: {
      // V2 官方取消途径：context.client.session.interrupt（data.session 无 interrupt）
      abort: ({ sessionID }) => context.client.session.interrupt({ sessionID }).then(() => {}),
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
