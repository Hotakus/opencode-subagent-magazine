/** @jsxImportSource @opentui/solid */

import type { JSX } from "@opentui/solid"
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiSlotContext,
  TuiSlotPlugin,
  TuiPluginModule,
  TuiThemeCurrent,
} from "@opencode-ai/plugin/tui"
import {
  createMemo,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  untrack,
  Show,
  For,
} from "solid-js"
import { PLUGIN_VERSION } from "./_version"

// ===================================================================
// Types
// ===================================================================

type SubStatus = "running" | "done" | "error"

interface SubEntry {
  id: string
  title: string
  agent: string
  prompt: string
  error?: string
  tokens?: number
  cost?: number
  status: SubStatus
  sessionId?: string
  startedAt: number
  endedAt?: number
  model?: string
  todoTotal?: number
  todoDone?: number
}

type Lang = "zh" | "en"
type SortOrder = "desc" | "asc"
type ScrollMode = "wheel" | "click"

/** OpenCode built-in tool names that spawn sub-agents or delegate tasks. */
const SUBAGENT_TOOLS = new Set(["task", "delegate", "call_omo_agent"])

// ===================================================================
// i18n
// ===================================================================

const I18N: Record<Lang, Record<string, string>> = {
  zh: {
    "panel.title": "子代理",
    "status.none": "暂无子代理",
    "agent.label": "代理",
    "status.label": "状态",
    "time.label": "耗时",
    "tokens.label": "上下文",
    "error.label": "错误",
    "model.label": "模型",
    "todo.label": "进度",
    "session.label": "会话 ID",
    "session.toast.copy": "可手动复制上方 ID",
    "open.label": "进入会话",
    "cost.label": "费用",
    "scroll.more": "更多",
    "scroll.top": "回顶",
    "scroll.bottom": "回底",
    "dismiss.label": "标记完成",
    "status.running": "运行中",
    "status.done": "已完成",
    "status.error": "错误",
    "order.desc": "降序（最新在前）",
    "order.asc": "升序（最早在前）",
    "scroll.wheel": "滚轮翻页",
    "scroll.click": "点击翻页",
    "ttl.label": "清理周期",
    "ttl.3d": "3 天",
    "ttl.7d": "7 天",
    "ttl.14d": "14 天",
    "ttl.30d": "30 天",
    "ttl.toast": "清理周期已设为 {n} 天",
    "clear.title": "确认清除",
    "clear.prompt": "确定清除当前会话所有子代理记录？此操作不可撤销。",
    "clear.done": "已清除 {n} 条子代理记录",
    "clear.empty": "当前会话无子代理记录",
  },
  en: {
    "panel.title": "SubAgent",
    "status.none": "No sub-agents yet",
    "agent.label": "agent",
    "status.label": "status",
    "time.label": "time",
    "tokens.label": "tokens",
    "error.label": "error",
    "model.label": "model",
    "todo.label": "todo",
    "session.label": "session ID",
    "session.toast.copy": "Copy the ID above manually",
    "open.label": "Open session",
    "cost.label": "cost",
    "scroll.more": "more",
    "scroll.top": "Top",
    "scroll.bottom": "Bottom",
    "dismiss.label": "dismiss",
    "status.running": "running",
    "status.done": "done",
    "status.error": "error",
    "order.desc": "Desc (newest first)",
    "order.asc": "Asc (oldest first)",
    "scroll.wheel": "Wheel Scroll",
    "scroll.click": "Click Scroll",
    "ttl.label": "TTL",
    "ttl.3d": "3 days",
    "ttl.7d": "7 days",
    "ttl.14d": "14 days",
    "ttl.30d": "30 days",
    "ttl.toast": "TTL set to {n} days",
    "clear.title": "Confirm",
    "clear.prompt": "Clear all sub-agent records for this session? This cannot be undone.",
    "clear.done": "Cleared {n} sub-agent record(s)",
    "clear.empty": "No sub-agent records in this session",
  },
}

declare const process: { env: Record<string, string | undefined> } | undefined

function detectLang(): Lang {
  const env = process?.env?.OPENCODE_LANG ?? process?.env?.LANG ?? ""
  if (env.startsWith("zh")) return "zh"
  return "en"
}

// ===================================================================
// Helpers — visual width
// ===================================================================

function charColumns(c: string): number {
  const code = c.codePointAt(0) ?? 0
  if (code < 0x20) return 0
  if (code < 0x7f) return 1
  if (code < 0xa0) return 0
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
    return 2
  return 1
}

function visualWidth(s: string): number {
  let w = 0
  for (const c of s) w += charColumns(c)
  return w
}

function truncate(text: string, maxCols: number): string {
  if (visualWidth(text) <= maxCols) return text
  let cols = 0
  let i = 0
  for (const c of text) {
    const w = charColumns(c)
    if (cols + w > maxCols - 1) break
    cols += w
    i += c.length
  }
  return text.slice(0, i) + "\u2026"
}

function fmtDurationShort(ms: number, running: boolean): string {
  if (running && ms < 2000) return ""
  if (ms < 1000) return (ms / 1000).toFixed(2) + "s"
  if (ms < 60000) return (ms / 1000).toFixed(2) + "s"
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m${s}s`
}

function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1000000).toFixed(1)}M`
}

// ===================================================================
// Color helpers — Morandi palette
// ===================================================================

function rgb(raw: unknown): { r: number; g: number; b: number } | null {
  if (typeof raw === "string" && raw.startsWith("#")) {
    const h = raw.slice(1)
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    }
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>
    if (typeof o.r === "number" && typeof o.g === "number" && typeof o.b === "number") {
      const scale = o.r > 1 || o.g > 1 || o.b > 1 ? 1 : 255
      return { r: Math.round(o.r * scale), g: Math.round(o.g * scale), b: Math.round(o.b * scale) }
    }
  }
  return null
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const delta = max - min
  if (delta === 0) return 0
  const L = (max + min) / 2
  return L <= 0.5 ? delta / (max + min) : delta / (2 - max - min)
}

function desaturateTo(raw: unknown, maxSat: number, fallback: string): string {
  const c = rgb(raw)
  if (!c) return fallback
  const sat = saturation(c.r, c.g, c.b)
  if (sat <= maxSat) {
    return "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")
  }
  const luma = c.r * 0.299 + c.g * 0.587 + c.b * 0.114
  let lo = 0, hi = 1
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    const nr = Math.round(c.r + (luma - c.r) * mid)
    const ng = Math.round(c.g + (luma - c.g) * mid)
    const nb = Math.round(c.b + (luma - c.b) * mid)
    if (saturation(nr, ng, nb) > maxSat) lo = mid
    else hi = mid
  }
  const nr = Math.round(c.r + (luma - c.r) * hi)
  const ng = Math.round(c.g + (luma - c.g) * hi)
  const nb = Math.round(c.b + (luma - c.b) * hi)
  return "#" + [nr, ng, nb].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
}

function dimColor(hex: string, factor = 0.5): string {
  const c = rgb(hex)
  if (!c) return hex
  const r = Math.round(c.r * factor)
  const g = Math.round(c.g * factor)
  const b = Math.round(c.b * factor)
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
}

const FALLBACK = {
  primary: "#8B9DAF", text: "#C5C5BB", muted: "#7A7A72",
  success: "#9CAF8B", warning: "#C5B88D", error: "#B08A8A", border: "#6B6B63",
} as const

const MAX_SAT = 0.28

/** Entry line left prefix: icon + space + status dot + space */
const LEFT_PAD = 4
/** Detail row indent: two spaces */
const INDENT = 2

function safeErrorMsg(err: unknown): string {
  if (!err) return ""
  if (typeof err === "string") return err
  if (typeof err === "object") return String((err as any).message || (err as any).code || "")
  return ""
}

// ===================================================================
// Sidebar component
// ===================================================================

// 模块级缓存：各 session 的 entry 状态独立存储，不随当前视图切换而清除。
const globalEntryCache = new Map<string, Map<string, SubEntry>>()

// 模块级刷新信号：外部（如斜杠命令）触发清除后 +1，组件 scan 依赖它以重扫。
const [clearTick, setClearTick] = createSignal(0)

function SubAgentPanel(props: {
  theme: TuiThemeCurrent
  api: TuiPluginApi
  lang: () => Lang
  maxEntries: () => number
  sortOrder: () => SortOrder
  scrollMode: () => ScrollMode
  sessionId: string
}): JSX.Element {
  const t = (key: string) => I18N[props.lang()][key] ?? key

  // ── session data (single-key, true deletion on cleanup) ──
  const SESSION_DATA_KEY = `${KV_PREFIX}.session_data`
  const ttlDays = parseInt(String(props.api.kv.get(`${KV_PREFIX}.ttl_days`, "3")), 10) || 3
  const TTL_MS = ttlDays * 24 * 60 * 60 * 1000

  interface ChildRecord {
    scroll: number
    expanded: string
    entries: SubEntry[]
    clearedIds?: string[]
  }

  interface SessionRecord {
    ts: number
    entries: SubEntry[]
    scroll: number
    expanded: string
    children: Record<string, ChildRecord>
    clearedIds?: string[]
  }

  const loadSessionData = (): Record<string, SessionRecord> => {
    try {
      const raw = props.api.kv.get(SESSION_DATA_KEY, "{}")
      return JSON.parse(String(raw))
    } catch { return {} }
  }

  const saveSessionData = (data: Record<string, SessionRecord>) => {
    try { props.api.kv.set(SESSION_DATA_KEY, JSON.stringify(data)) } catch {}
  }

  /** 将任意 session ID 解析为父会话 ID + 是否子会话。
   *  通过 SDK session.get(sid).parentID 判断，无 parentID 即为主会话。 */
  const resolveParent = (sid: string): { parentSid: string; isChild: boolean } => {
    try {
      const session = props.api.state.session.get(sid)
      const parentID = (session as any)?.parentID as string | undefined
      if (parentID) return { parentSid: parentID, isChild: true }
    } catch {}
    return { parentSid: sid, isChild: false }
  }

  const loadEntries = (sid: string): Map<string, SubEntry> => {
    const m = new Map<string, SubEntry>()
    try {
      const { parentSid, isChild } = resolveParent(sid)
      const rec = loadSessionData()[parentSid]
      if (rec) {
        const source = isChild ? rec.children?.[sid]?.entries : rec.entries
        if (source) {
          for (const e of source) m.set(e.id, e)
        }
      }
    } catch {}
    return m
  }

  let persistTimer: ReturnType<typeof setTimeout> | undefined
  const persistEntries = (sid: string, entries: Map<string, SubEntry>) => {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      try {
        const data = loadSessionData()
        const { parentSid, isChild } = resolveParent(sid)
        if (isChild) {
          if (!data[parentSid]) data[parentSid] = { ts: Date.now(), entries: [], scroll: 0, expanded: "", children: {} }
          if (!data[parentSid].children) data[parentSid].children = {}
          if (!data[parentSid].children[sid]) data[parentSid].children[sid] = { scroll: 0, expanded: "", entries: [] }
          data[parentSid].children[sid] = { ...data[parentSid].children[sid], entries: [...entries.values()] }
        } else {
          data[sid] = { ...data[sid], ts: Date.now(), entries: [...entries.values()], children: data[sid]?.children ?? {} }
        }
        saveSessionData(data)
      } catch {}
    }, 200)
  }

  const persistScroll = (sid: string, scroll: number) => {
    try {
      const data = loadSessionData()
      const { parentSid, isChild } = resolveParent(sid)
      if (isChild) {
        if (!data[parentSid]) data[parentSid] = { ts: Date.now(), entries: [], scroll: 0, expanded: "", children: {} }
        if (!data[parentSid].children) data[parentSid].children = {}
        if (!data[parentSid].children[sid]) data[parentSid].children[sid] = { scroll: 0, expanded: "", entries: [] }
        data[parentSid].children[sid] = { ...data[parentSid].children[sid], scroll }
      } else {
        data[sid] = { ...data[sid], ts: Date.now(), scroll, children: data[sid]?.children ?? {} }
      }
      saveSessionData(data)
    } catch {}
  }

  const persistExpanded = (sid: string, expanded: string) => {
    try {
      const data = loadSessionData()
      const { parentSid, isChild } = resolveParent(sid)
      if (isChild) {
        if (!data[parentSid]) data[parentSid] = { ts: Date.now(), entries: [], scroll: 0, expanded: "", children: {} }
        if (!data[parentSid].children) data[parentSid].children = {}
        if (!data[parentSid].children[sid]) data[parentSid].children[sid] = { scroll: 0, expanded: "", entries: [] }
        data[parentSid].children[sid] = { ...data[parentSid].children[sid], expanded }
      } else {
        data[sid] = { ...data[sid], ts: Date.now(), expanded, children: data[sid]?.children ?? {} }
      }
      saveSessionData(data)
    } catch {}
  }

  const cleanupOldSessions = () => {
    try {
      const data = loadSessionData()
      const cutoff = Date.now() - TTL_MS
      let changed = false
      for (const sid of Object.keys(data)) {
        if (data[sid].ts < cutoff) {
          delete data[sid]
          changed = true
        }
      }
      if (changed) saveSessionData(data)
    } catch {}
  }

  cleanupOldSessions()

  const [entryMap, setEntryMapRaw] = createSignal(loadEntries(props.sessionId))

  // Wrapped setter — also persists to kv on every mutation
  const setEntryMap = (
    arg: Map<string, SubEntry> | ((prev: Map<string, SubEntry>) => Map<string, SubEntry>),
  ) => {
    setEntryMapRaw((prev) => {
      const next = typeof arg === "function" ? (arg as Function)(prev) : arg

      // entry 状态落定（done/error）时立即持久化到 KV，跳过常规 debounce，
      // 确保跨视图的状态一致性。
      let needsImmediateFlush = false
      for (const [id, entry] of next) {
        const prevEntry = prev.get(id)
        if (prevEntry?.status === "running" && (entry.status === "done" || entry.status === "error")) {
          needsImmediateFlush = true
          break
        }
      }

      if (needsImmediateFlush) {
        clearTimeout(persistTimer)
        try {
          const data = loadSessionData()
          const { parentSid, isChild } = resolveParent(props.sessionId)
          if (isChild) {
            if (!data[parentSid]) data[parentSid] = { ts: Date.now(), entries: [], scroll: 0, expanded: "", children: {} }
            if (!data[parentSid].children) data[parentSid].children = {}
            if (!data[parentSid].children[props.sessionId]) data[parentSid].children[props.sessionId] = { scroll: 0, expanded: "", entries: [] }
            data[parentSid].children[props.sessionId] = { ...data[parentSid].children[props.sessionId], entries: [...next.values()] }
          } else {
            data[props.sessionId] = { ...data[props.sessionId], ts: Date.now(), entries: [...next.values()], children: data[props.sessionId]?.children ?? {} }
          }
          saveSessionData(data)
        } catch {}
      } else {
        persistEntries(props.sessionId, next)
      }

      // 同步到模块级缓存，供其他视图读取当前 session 的最新状态
      globalEntryCache.set(props.sessionId, new Map(next))

      return next
    })
  }

  const [panelWidth, setPanelWidth] = createSignal(28)
  const [open, setOpen] = createSignal(
    (() => { try { return props.api.kv.get(`${KV_PREFIX}.open`, true) as boolean } catch { return true } })()
  )
  const [expanded, setExpanded] = createSignal<string | undefined>(
    (() => {
      try {
        const { parentSid, isChild } = resolveParent(props.sessionId)
        const rec = loadSessionData()[parentSid]
        if (rec) return isChild ? rec.children?.[props.sessionId]?.expanded || undefined : rec.expanded || undefined
      } catch {}
      return undefined
    })(),
  )
  const [hoveredOpen, setHoveredOpen] = createSignal<string | undefined>(undefined)
  const [hoveredDismiss, setHoveredDismiss] = createSignal<string | undefined>(undefined)
  const [hoveredTop, setHoveredTop] = createSignal(false)
  const [hoveredMoreAbove, setHoveredMoreAbove] = createSignal(false)
  const [hoveredMoreBelow, setHoveredMoreBelow] = createSignal(false)
  const [scrollOffset, setScrollOffset] = createSignal(
    (() => {
      try {
        const { parentSid, isChild } = resolveParent(props.sessionId)
        const rec = loadSessionData()[parentSid]
        return isChild ? rec?.children?.[props.sessionId]?.scroll ?? 0 : rec?.scroll ?? 0
      } catch { return 0 }
    })(),
  )
  const [now, setNow] = createSignal(Date.now())
  const [renderTick, setRenderTick] = createSignal(0)

  let boxEl: any
  let disposed = false

  /** Total context tokens for a sub-agent session.
   *  Matches opencode-visual-cache's "总计": last assistant message's input + cache.read. */
  const readSessionTokens = (sid: string): number | undefined => {
    if (!sid) return undefined
    try {
      const msgs = props.api.state.session.messages(sid)
      if (msgs) {
        for (let i = (msgs as any[]).length - 1; i >= 0; i--) {
          const m = (msgs as any[])[i]
          if (m.role !== "assistant") continue
          const t = m.tokens
          if (!t) continue
          const cache = t.cache as { read?: number; write?: number } | undefined
          const ctx = (Number(t.input) || 0) + (cache?.read ?? 0)
          if (ctx > 0) return ctx
        }
      }
      return undefined
    } catch {
      return undefined
    }
  }

  /** Sum USD cost from a session's messages.
   *  Prefers the database-level aggregate (`session.cost`) which is not affected
   *  by the sync layer's `limit: 100` message window.  Falls back to message
   *  traversal when the aggregate is unavailable (older SDK versions). */
  const readSessionCost = (sid: string): number | undefined => {
    if (!sid) return undefined
    try {
      const session = props.api.state.session.get(sid)
      if (session?.cost != null && session.cost > 0) return session.cost
      const msgs = props.api.state.session.messages(sid)
      if (!msgs) return undefined
      let total = 0
      for (const m of msgs as any[]) {
        if (m.role === "assistant" && typeof m.cost === "number") total += m.cost
      }
      return total > 0 ? total : undefined
    } catch {
      return undefined
    }
  }

  /** Last assistant message's modelID for a sub-agent session. */
  const readSessionModel = (sid: string): string | undefined => {
    if (!sid) return undefined
    try {
      const msgs = props.api.state.session.messages(sid)
      if (msgs) {
        for (let i = (msgs as any[]).length - 1; i >= 0; i--) {
          const m = (msgs as any[])[i]
          if (m.role === "assistant" && m.modelID) return String(m.modelID)
        }
      }
      return undefined
    } catch {
      return undefined
    }
  }

  /** Todo completion stats for a sub-agent session.
   *  `done` counts completed + cancelled items. */
  const readSessionTodo = (sid: string): { total: number; done: number } | undefined => {
    if (!sid) return undefined
    try {
      const todos = props.api.state.session.todo(sid)
      if (!todos || todos.length === 0) return undefined
      let done = 0
      for (const t of todos) {
        if (t.status === "completed" || t.status === "cancelled") done++
      }
      return { total: todos.length, done }
    } catch {
      return undefined
    }
  }

  // ── upsert ──
  const upsertEntry = (
    partial: Omit<SubEntry, "startedAt" | "endedAt"> & { startedAt?: number }
  ) => {
    setEntryMap((prev) => {
      const existing = prev.get(partial.id)
      const next = new Map(prev)
      const nowTs = Date.now()
      const e = partial.status
      const ended = e === "done" || e === "error"
      next.set(partial.id, {
        ...(existing ?? { startedAt: nowTs }),
        ...partial,
        startedAt: existing?.startedAt || partial.startedAt || nowTs,
        endedAt: ended ? (existing?.endedAt || nowTs) : undefined,
      })
      return next
    })
  }

  // ── event handlers ──
  const handlePartUpdated = (event: unknown) => {
    const e = event as Record<string, unknown>
    const props_ = e.properties as Record<string, unknown> | undefined
    const part = props_?.part as Record<string, unknown> | undefined
    if (!part) return

    // SubtaskPart
    if (part.type === "subtask") {
      const agent = String(part.agent ?? "?")
      const prompt = String(part.prompt ?? "")
      const desc = String(part.description ?? "")
      const title = desc || truncate(prompt.replace(/\n/g, " ").replace(/\s+/g, " ").trim(), 40)

      const id = `sub:${String(part.id ?? crypto.randomUUID())}`
      const subSid = part.sessionID !== undefined ? String(part.sessionID) : undefined
      const partModel = part.model as { modelID?: string } | undefined
      const modelId = partModel?.modelID ? String(partModel.modelID) : undefined
      upsertEntry({ id, title, agent, prompt, sessionId: subSid, status: "running", model: modelId })
    }

    // ToolPart
    if (part.type === "tool") {
      const tool = String(part.tool ?? "")
      if (!SUBAGENT_TOOLS.has(tool)) return
      const st = part.state as Record<string, unknown> | undefined
      const rawStatus = String(st?.status ?? "")

      // Only create entries for tool calls that actually entered execution.
      // "pending" / empty → state unknown yet, wait for next event
      if (rawStatus === "pending" || rawStatus === "") return

      // "error" → tool call failed, sub-agent never spawned.
      // Only update an existing entry (e.g. previously running → now error),
      // never create a new one.
      if (rawStatus === "error") {
        const id = `tool:${String(part.id ?? "")}`
        if (!part.id) return
        const existing = entryMap().get(id)
        if (existing) {
          upsertEntry({ id, title: existing.title, agent: existing.agent, prompt: existing.prompt, status: "error" })
        }
        return
      }

      // rawStatus is "running" or "completed" — tool entered execution, track it.
      const input = st?.input as Record<string, unknown> | undefined
      let status: SubStatus = "running"
      if (rawStatus === "completed") status = "done"
      // Background tasks: tool completion ≠ agent completion — keep running until session.idle
      // Only keep running if state metadata confirms a child session was spawned;
      // otherwise (failed spawn, invalid agent) mark as done so the entry isn't stuck forever.
      if (input?.run_in_background === true && status === "done") {
        const stMetaCheck = st?.metadata as Record<string, unknown> | undefined
        const hasChild = stMetaCheck?.session_id !== undefined || stMetaCheck?.sessionId !== undefined
        if (hasChild) status = "running"
      }

      const agent = String((part as any).subagent_type ?? input?.subagent_type ?? input?.category ?? tool)
      const prompt = String(input?.prompt ?? (part as any).description ?? "")
      const desc = input?.description !== undefined ? String(input.description) : ""
      const title = desc || truncate(prompt.replace(/\n/g, " ").replace(/\s+/g, " ").trim(), 40)

      const id = `tool:${String(part.id ?? crypto.randomUUID())}`
      // Child session ID lives in state-level metadata (ToolStateCompleted.metadata),
      // injected by the tool executor.  ToolPart.sessionID is the parent session.
      const stMeta = st?.metadata as Record<string, unknown> | undefined
      const subSid = stMeta?.session_id !== undefined ? String(stMeta.session_id)
        : stMeta?.sessionId !== undefined ? String(stMeta.sessionId)
        : undefined
      upsertEntry({ id, title, agent, prompt, sessionId: subSid, status })
    }
  }

  const handleSessionEnd = (event: unknown, status: SubStatus) => {
    const e = event as Record<string, unknown>
    const props_ = e.properties as Record<string, unknown> | undefined
    const sid = String(props_?.sessionID ?? "")
    if (!sid) return

    const sessionTokens = readSessionTokens(sid)
    const sessionCost = readSessionCost(sid)
    const sessionModel = readSessionModel(sid)
    const sessionTodo = readSessionTodo(sid)
    let sessionAgent: string | undefined
    let errorMsg: string | undefined
    try {
      const s = props.api.state.session.get(sid)
      sessionAgent = s?.agent
      if (status === "error") {
        const evtErr = props_?.error as Record<string, unknown> | undefined
        errorMsg = safeErrorMsg(evtErr) || safeErrorMsg(props_?.message)
        if (!errorMsg) {
          const msgs = props.api.state.session.messages(sid)
          if (msgs) {
            for (let i = (msgs as any[]).length - 1; i >= 0; i--) {
              const m = (msgs as any[])[i]
              if (m.role === "assistant" && m.error) {
                errorMsg = safeErrorMsg(m.error)
                break
              }
            }
          }
        }
      }
    } catch {}

    // 在给定的 entries Map 中查找并更新匹配的子代理 entry。
    // 返回 true 表示找到并更新了，false 表示未找到。
    const tryMatchAndUpdate = (
      entriesMap: Map<string, SubEntry>,
      targetSid: string,
      targetStatus: SubStatus,
      nowTs: number,
    ): boolean => {
      // 精确匹配：sessionId 对得上 + 状态为 running
      for (const [, entry] of entriesMap) {
        if (entry.sessionId === targetSid && entry.status === "running") {
          entry.status = targetStatus
          entry.endedAt = nowTs
          entry.tokens = entry.tokens ?? sessionTokens
          entry.cost = entry.cost ?? sessionCost
          entry.model = entry.model ?? sessionModel
          entry.todoTotal = entry.todoTotal ?? sessionTodo?.total
          entry.todoDone = entry.todoDone ?? sessionTodo?.done
          entry.error = errorMsg || entry.error
          return true
        }
      }
      // 回退：sessionId 未关联但 agent 名匹配 + 状态为 running
      if (sessionAgent) {
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "")
        const saNorm = normalize(sessionAgent)
        let best: { entry: SubEntry; gap: number } | null = null
        for (const [, entry] of entriesMap) {
          if (entry.status !== "running") continue
          const eaNorm = normalize(entry.agent)
          if (!eaNorm || !saNorm) continue
          if (!eaNorm.includes(saNorm) && !saNorm.includes(eaNorm)) continue
          const gap = nowTs - (entry.startedAt || 0)
          if (!best || gap > best.gap) best = { entry, gap }
        }
        if (!best) {
          for (const [, entry] of entriesMap) {
            if (entry.status !== "running") continue
            if (entry.sessionId) continue
            const gap = nowTs - (entry.startedAt || 0)
            if (!best || gap > best.gap) best = { entry, gap }
          }
        }
        if (best) {
          best.entry.status = targetStatus
          best.entry.endedAt = nowTs
          best.entry.tokens = best.entry.tokens ?? sessionTokens
          best.entry.cost = best.entry.cost ?? sessionCost
          best.entry.model = best.entry.model ?? sessionModel
          best.entry.todoTotal = best.entry.todoTotal ?? sessionTodo?.total
          best.entry.todoDone = best.entry.todoDone ?? sessionTodo?.done
          best.entry.sessionId = targetSid
          best.entry.error = errorMsg || best.entry.error
          return true
        }
      }
      return false
    }

    setEntryMap((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const [id, entry] of next) {
        if (entry.sessionId !== sid) continue
        if (entry.status !== "running" && entry.status !== "done") continue
        // Skip parent session idle — subagent entries belong to child sessions only
        if (sid === props.sessionId) continue
        // For "done" entries (sync tasks completed before session.idle), only backfill tokens/cost
        const alreadySettled = entry.status !== "running"
        next.set(id, {
          ...entry,
          ...(alreadySettled ? {} : { status, endedAt: Date.now() }),
          tokens: entry.tokens ?? sessionTokens,
          cost: entry.cost ?? sessionCost,
          model: entry.model ?? sessionModel,
          todoTotal: entry.todoTotal ?? sessionTodo?.total,
          todoDone: entry.todoDone ?? sessionTodo?.done,
          error: errorMsg || entry.error,
        })
        changed = true
      }
      if (!changed && sessionAgent) {
        const nowTs = Date.now()
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "")
        const saNorm = normalize(sessionAgent)
        let best: { id: string; gap: number } | null = null

        // Phase 1: try matching by agent name（agent 名有交集）
        for (const [id, entry] of next) {
          if (entry.status !== "running") continue
          const eaNorm = normalize(entry.agent)
          if (!eaNorm || !saNorm) continue
          if (!eaNorm.includes(saNorm) && !saNorm.includes(eaNorm)) continue
          const gap = nowTs - (entry.startedAt || 0)
          if (!best || gap > best.gap) best = { id, gap }
        }

        // Phase 2: if agent name has no overlap (e.g. category calls: agent="deep" vs sessionAgent="Sisyphus-Junior"),
        // fall back to time proximity for entries that have no sessionId yet
        if (!best) {
          for (const [id, entry] of next) {
            if (entry.status !== "running") continue
            if (entry.sessionId) continue
            const gap = nowTs - (entry.startedAt || 0)
            if (!best || gap > best.gap) best = { id, gap }
          }
        }

        if (best) {
          const entry = next.get(best.id)!
          next.set(best.id, {
            ...entry, status, endedAt: nowTs,
            tokens: sessionTokens || entry.tokens,
            cost: sessionCost || entry.cost,
            sessionId: sid,
            error: errorMsg || entry.error,
          })
          changed = true
        }
      }
      return changed ? next : prev
    })

    // 当子代理所属的父 session 与当前视图不同时，通过模块级缓存定位
    // 并更新父 session 的 entry 状态，随后写回 KV。
    try {
      const sessionObj = props.api.state.session.get(sid)
      const parentSid = sessionObj?.parentID
      if (parentSid && parentSid !== props.sessionId) {
        // 优先从模块级缓存获取父 session 的 entries，不受当前视图切换影响
        const parentCache = globalEntryCache.get(parentSid)
        const nowTs = Date.now()
        let found = false

        if (parentCache) {
          found = tryMatchAndUpdate(parentCache, sid, status, nowTs)
        }

        // 缓存未命中时回退到 KV 读取
        if (!found) {
          const data = loadSessionData()
          const rec = data[parentSid]
          if (rec?.entries) {
            const fallbackMap = new Map(rec.entries.map((e: SubEntry) => [e.id, e]))
            found = tryMatchAndUpdate(fallbackMap, sid, status, nowTs)
            if (found) {
              // 回退命中后写入 KV 并回填缓存
              data[parentSid] = { ...rec, ts: nowTs, entries: [...fallbackMap.values()] }
              saveSessionData(data)
              globalEntryCache.set(parentSid, fallbackMap)
            }
          }
        }

        // 将模块级缓存中的最新状态同步到 KV
        if (found && parentCache) {
          const data = loadSessionData()
          data[parentSid] = { ...data[parentSid], ts: nowTs, entries: [...parentCache.values()] }
          saveSessionData(data)
        }
      }
    } catch {}

    // Delayed backfill: re-read data after state sync catches up, to capture the final
    // token/cost values that may not have been available when session.idle fired.
    setTimeout(() => {
      if (disposed) return
      const finalTokens = readSessionTokens(sid)
      const finalCost = readSessionCost(sid)
      const finalModel = readSessionModel(sid)
      const finalTodo = readSessionTodo(sid)
      setEntryMap((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const [id, entry] of next) {
          if (entry.sessionId !== sid) continue
          const t = finalTokens ?? entry.tokens
          const c = finalCost ?? entry.cost
          const m = finalModel ?? entry.model
          const tt = finalTodo?.total ?? entry.todoTotal
          const td = finalTodo?.done ?? entry.todoDone
          if (t !== entry.tokens || c !== entry.cost || m !== entry.model ||
              tt !== entry.todoTotal || td !== entry.todoDone) {
            next.set(id, { ...entry, tokens: t, cost: c, model: m, todoTotal: tt, todoDone: td })
            changed = true
          }
        }
        return changed ? next : prev
      })
      bump()
    }, 150)
  }

  // ── bumpRenderTick: force re-render (visual-cache pattern) ──
  const bump = () => setRenderTick((v) => v + 1)

  onMount(() => {
    // Fast clock for smooth time display, separate from token polling
    const clock = setInterval(() => { setNow(Date.now()); bump() }, 100)
    // Token poll — runs every 500ms for running entries
    const tokenTimer = setInterval(() => {
      untrack(() => {
        setEntryMapRaw((prev) => {
          let changed = false
          const next = new Map(prev)
          for (const [id, entry] of next) {
            if (entry.status === "running" && entry.sessionId) {
              // Only read from child sessions, never the parent
              let isChild = false
              try {
                const s = props.api.state.session.get(entry.sessionId)
                isChild = s?.parentID === props.sessionId
              } catch {}
              if (!isChild) continue
              const total = readSessionTokens(entry.sessionId)
              const todo = readSessionTodo(entry.sessionId)
              const model = entry.model ?? readSessionModel(entry.sessionId)
              const nextEntry: SubEntry = { ...entry }
              if (total !== undefined && total !== entry.tokens) { nextEntry.tokens = total; changed = true }
              if (todo !== undefined) {
                if (todo.total !== entry.todoTotal || todo.done !== entry.todoDone) {
                  nextEntry.todoTotal = todo.total; nextEntry.todoDone = todo.done; changed = true
                }
              }
              if (model && !entry.model) { nextEntry.model = model; changed = true }
              if (changed) next.set(id, nextEntry)
            }
          }
          return changed ? next : prev
        })
      })
      bump()
    }, 500)
    bump()

    const unsubPart = props.api.event.on("message.part.updated", (e) => {
      handlePartUpdated(e)
      bump()
    })
    const unsubMsg = props.api.event.on("message.updated", () => bump())
    const unsubIdle = props.api.event.on("session.idle", (e) => {
      handleSessionEnd(e, "done")
      bump()
    })
    const unsubError = props.api.event.on("session.error", (e) => {
      handleSessionEnd(e, "error")
      bump()
    })

    onCleanup(() => {
      disposed = true
      clearInterval(clock)
      clearInterval(tokenTimer)
      unsubPart()
      unsubMsg()
      unsubIdle()
      unsubError()
    })
  })

  // ── session‑switch & initial‑load scan ──
  // On session change: load from kv (entries survive component unmount), then scan+merge.
  // On same session: only scan+merge (keep event‑driven running entries).
  let lastSid = props.sessionId
  createEffect(() => {
    const sid = props.sessionId
    const switched = sid !== lastSid
    lastSid = sid
    const t = setTimeout(() => {
      untrack(() => {
        void clearTick() // 外部触发的清除事件 → 重扫
        if (switched) {
          const { parentSid, isChild } = resolveParent(sid)
          const data = loadSessionData()
          const saved = isChild
            ? data[parentSid]?.children?.[sid]?.scroll ?? 0
            : data[sid]?.scroll ?? 0
          setScrollOffset(saved)
          // 刷新父会话的访问时间 TTL，防止活跃会话的数据过期
          if (!isChild && data[sid]?.entries?.length) {
            data[sid].ts = Date.now()
            saveSessionData(data)
          }
        }
        // scan uses setEntryMapRaw — ephemeral data, not persisted to kv.
        // Only event-driven changes (handlePartUpdated, handleSessionEnd) persist.
        setEntryMapRaw((prev) => {
          // 优先从模块级缓存加载，KV 仅作缓存未命中时的回退
          const next = switched
            ? new Map(globalEntryCache.get(sid) ?? loadEntries(sid))
            : new Map(prev)
          // 从 KV 加载当前会话的清除名单，扫描时跳过被手动清除的历史条目
          const { parentSid: scanPSid, isChild: scanChild } = resolveParent(sid)
          const scanRec = loadSessionData()[scanPSid]
          const clearedIds = new Set(scanChild ? scanRec?.children?.[sid]?.clearedIds : scanRec?.clearedIds)
          try {
            const msgs = props.api.state.session.messages(sid)
            if (msgs && (msgs as any[]).length) {
              for (const msg of msgs) {
                const parts = props.api.state.part(msg.id) ?? []
                for (const partRaw of parts) {
                  const part = partRaw as Record<string, unknown>

                  // Subtask entries are purely event-driven — never created by scan.
                  // (SubtaskPart exists from spawn, not completion, so we cannot infer status.)
                  if (part.type === "tool") {
                    const tool = String((part as any).tool ?? "")
                    if (!SUBAGENT_TOOLS.has(tool)) continue
                    const id = `tool:${String(part.id ?? "")}`
                    if (!part.id) continue

                    const st = (part as any).state as Record<string, unknown> | undefined
                    const rawStatus = String(st?.status ?? "")
                    const exists = next.get(id)

                    // 已手动清除的条目：scan 发现但不在内存 → 跳过重建
                    if (!exists && clearedIds.has(id)) continue

                    // Only create entries for tool calls that entered execution.
                    // "pending" / empty: skip new entries; allow heuristics for existing ones below.
                    if ((rawStatus === "pending" || rawStatus === "") && !exists) continue

                    // "error": only update existing, never create a new entry
                    if (rawStatus === "error") {
                      if (exists && exists.status === "running") {
                        next.set(id, { ...exists, status: "error", endedAt: Date.now() })
                      }
                      continue
                    }

                    let status: SubStatus = "running"
                    if (rawStatus === "completed") status = "done"
                    // Background tasks: tool completion ≠ agent completion — keep running until session.idle
                    // Only keep running if state metadata confirms a child session was spawned.
                    if ((st?.input as Record<string, unknown> | undefined)?.run_in_background === true && status === "done") {
                      const scanStMeta = st?.metadata as Record<string, unknown> | undefined
                      const scanHasChild = scanStMeta?.session_id !== undefined || scanStMeta?.sessionId !== undefined
                      if (scanHasChild) status = "running"
                    }

                    // Already settled → skip
                    if (exists && exists.status !== "running") continue
                    // Running entry with no explicit status improvement from part:
                    // try message-level heuristics first, then time-based fallback.
                    if (exists && status === "running") {
                      if (!rawStatus) {
                        const msgTokens = (msg as any)?.tokens as Record<string, unknown> | undefined
                        if (msgTokens && (Number(msgTokens.input) > 0 || Number(msgTokens.output) > 0)) {
                          status = "done"  // LLM returned tokens → agent completed
                        } else if (Date.now() - exists.startedAt > 30 * 60 * 1000) {
                          status = "done"  // >30 min idle → assume completed
                        } else {
                          continue
                        }
                      } else {
                        continue
                      }
                    }

                    // If already tracked as running but tool state says completed/error → update
                    // If not tracked → add fresh

                    const input = st?.input as Record<string, unknown> | undefined
                    const agent = String((part as any).subagent_type ?? input?.subagent_type ?? tool)
                    const prompt = String(input?.prompt ?? (part as any).description ?? "")
                    const desc = input?.description !== undefined ? String(input.description) : ""
                    const title = desc || truncate(prompt.replace(/\n/g, " ").trim(), 40)

                    let tokens: number | undefined
                    const scanStMeta2 = st?.metadata as Record<string, unknown> | undefined
                    const scanSubSid = scanStMeta2?.session_id !== undefined ? String(scanStMeta2.session_id)
                      : scanStMeta2?.sessionId !== undefined ? String(scanStMeta2.sessionId)
                      : undefined
                    if (scanSubSid) tokens = readSessionTokens(scanSubSid)

                    const ended = status === "done"  // "error" handled above, never reaches here
                    next.set(id, {
                      id, title, agent, prompt,
                      // Preserve existing values (from handleSessionEnd / KV) — scan must not overwrite
                      tokens: exists?.tokens ?? tokens,
                      sessionId: exists?.sessionId ?? scanSubSid,
                      status,
                      startedAt: exists?.startedAt || Date.now(),
                      endedAt: ended ? (exists?.endedAt || Date.now()) : undefined,
                    })
                  }
                }
              }
            }
          } catch {}
          return next
        })
        // Reconcile: check running entries against live child session status.
        // Covers session.idle events missed while user was inside a child session.
        setEntryMapRaw((prev) => {
          let changed = false
          const next = new Map(prev)
          for (const [id, entry] of next) {
            if (entry.status !== "running" || !entry.sessionId) continue
            try {
              const st = props.api.state.session.status(entry.sessionId)
              if (!st || st.type !== "idle") continue
              const tokens = readSessionTokens(entry.sessionId)
              const cost = readSessionCost(entry.sessionId)
              next.set(id, {
                ...entry, status: "done" as SubStatus, endedAt: Date.now(),
                tokens: tokens ?? entry.tokens,
                cost: cost ?? entry.cost,
              })
              changed = true
            } catch {}
          }
          return changed ? next : prev
        })
        bump()
      })
    }, 150)
    onCleanup(() => clearTimeout(t))
  })

  // ── palette ──
  const pal = createMemo(() => {
    const th = props.theme as Record<string, unknown>
    const sat = (k: string, fb: string) => desaturateTo(th[k], MAX_SAT, fb)
    return {
      primary: sat("primary", FALLBACK.primary),
      text: sat("text", FALLBACK.text),
      muted: sat("textMuted", FALLBACK.muted),
      success: sat("success", FALLBACK.success),
      warning: sat("warning", FALLBACK.warning),
      error: sat("error", FALLBACK.error),
      border: sat("border", FALLBACK.border),
    }
  })

  // ── derived signals ──
  // Stable list — only changes when entryMap changes
  const entryList = createMemo(() => {
    const entries = [...entryMap().values()]
    if (props.sortOrder() === "desc") {
      return entries.sort((a, b) => b.startedAt - a.startedAt)
    }
    return entries.sort((a, b) => a.startedAt - b.startedAt)
  })

  const max = props.maxEntries
  const clampedOffset = createMemo(() => {
    const total = entryList().length
    const m = max()
    if (total <= m) return 0
    return Math.min(scrollOffset(), total - m)
  })
  const visibleList = createMemo(() => entryList().slice(clampedOffset(), clampedOffset() + max()))
  const hiddenAbove = createMemo(() => clampedOffset())
  const hiddenBelow = createMemo(() => Math.max(0, entryList().length - clampedOffset() - max()))

  // Drop hover state when ↑ more disappears (hiddenAbove hits zero)
  createEffect(() => {
    if (hiddenAbove() === 0) setHoveredMoreAbove(false)
  })

  // Reset scroll on sort order change: jump to newest in view
  let sortInitialized = false
  createEffect(() => {
    props.sortOrder()
    if (!sortInitialized) { sortInitialized = true; return }
    const total = untrack(() => entryList().length)
    const m = untrack(() => max())
    const target = props.sortOrder() === "desc" ? 0 : Math.max(0, total - m)
    setScrollOffset(target)
    setTimeout(() => {
      try { persistScroll(props.sessionId, target) } catch {}
    }, 0)
  })

  // When new entries arrive while viewing the newest end, keep the view at newest
  let prevEntryCount = 0
  createEffect(() => {
    const total = entryList().length
    if (prevEntryCount === 0) { prevEntryCount = total; return }
    if (total === prevEntryCount) return

    const m = max()
    const wasAtNewest = props.sortOrder() === "desc"
      ? untrack(() => scrollOffset() === 0)
      : untrack(() => scrollOffset() >= prevEntryCount - m)

    prevEntryCount = total

    if (wasAtNewest) {
      const target = props.sortOrder() === "desc" ? 0 : Math.max(0, total - m)
      setScrollOffset(target)
      setTimeout(() => {
        try { persistScroll(props.sessionId, target) } catch {}
      }, 0)
    }
  })

  const entries = createMemo(() => {
    const nowVal = now()
    return entryList().map((e) => ({
      ...e,
      elapsed: (e.endedAt ?? nowVal) - e.startedAt,
    }))
  })

  const doneCount = createMemo(() => entryList().filter((e) => e.status === "done").length)
  const runningCount = createMemo(() => entryList().filter((e) => e.status === "running").length)
  const errCount = createMemo(() => entryList().filter((e) => e.status === "error").length)
  const anyEntry = () => entryList().length > 0

  const totalTokens = createMemo(() => {
    let sum = 0
    for (const e of entryList()) { if (e.tokens) sum += e.tokens }
    return sum
  })

  const totalCost = createMemo(() => {
    let sum = 0
    for (const e of entryList()) { if (e.cost) sum += e.cost }
    return sum
  })

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = prev === id ? undefined : id
      try { persistExpanded(props.sessionId, next ?? "") } catch {}
      return next
    })
  }

  const sep = () => "\u2500".repeat(Math.max(1, panelWidth()))

  // ── expanded detail right-align ──
  const expandedMaxLabelW = createMemo(() => {
    const labels = [
      t("agent.label"), t("status.label"), t("time.label"), t("tokens.label"),
      t("error.label"), t("cost.label"), t("model.label"), t("todo.label"), t("session.label"),
    ]
    return Math.max(...labels.map(l => visualWidth(l + ": ")))
  })

  const expandedPad = (label: string) => Math.max(0, expandedMaxLabelW() - visualWidth(label + ": "))

  const expandedValAvail = () => Math.max(6, panelWidth() - INDENT - expandedMaxLabelW())

  // ── header parts for colored spans ──
  const summaryParts = createMemo(() => {
    if (!anyEntry()) return null
    const dot = "\u25cf"
    const cost = totalCost()
    return {
      done: `${dot}${doneCount()}`,
      running: runningCount() > 0 ? `${dot}${runningCount()}` : null,
      err: errCount() > 0 ? `${dot}${errCount()}` : null,
      duration: totalTokens() > 0 ? fmtTokens(totalTokens()) : "",
      cost: cost > 0 ? `$${cost.toFixed(2)}` : "",
    }
  })

  const summaryCols = createMemo(() => {
    const p = summaryParts()
    if (!p) return 0
    let w = visualWidth(p.done)
    if (p.running) w += 1 + visualWidth(p.running)
    if (p.err) w += 1 + visualWidth(p.err)
    w += p.duration ? 1 + visualWidth(p.duration) : 0
    w += p.cost ? 1 + visualWidth(p.cost) : 0
    return w
  })

  const versionText = ` v${PLUGIN_VERSION}`
  const versionW = visualWidth(versionText)

  const showVersion = createMemo(() => {
    if (!open()) return false
    const icon = "\u25bc"
    const need = visualWidth(icon) + 1 + visualWidth(t("panel.title")) + versionW + summaryCols()
    return need <= panelWidth()
  })

  const leftCols = createMemo(() => {
    const icon = open() ? "\u25bc" : "\u25b6"
    let w = visualWidth(icon) + 1 + visualWidth(t("panel.title"))
    if (showVersion()) w += versionW
    return w
  })

  const spacerCols = createMemo(() => {
    if (!anyEntry()) return 0
    return Math.max(0, panelWidth() - leftCols() - summaryCols())
  })

  const valueCols = (label: string) =>
    Math.max(4, panelWidth() - INDENT - visualWidth(label + ": "))

  // ── render ──
  return (
    <box
      border={false}
      paddingTop={0} paddingBottom={0} paddingLeft={0} paddingRight={0}
      flexDirection="column" gap={0}
      ref={boxEl}
      onSizeChange={() => {
        const w = boxEl ? Math.max(20, boxEl.width ?? 0) : 28
        setPanelWidth((prev) => (prev === w ? prev : w))
      }}
    >
      {/* ── header: same pattern as visual-cache's fold toggle ── */}
      {/* renderTick in span forces the text element to re-evaluate */}
      <text
        onMouseUp={() => {
          setOpen((o) => {
            const n = !o
            try { props.api.kv.set(`${KV_PREFIX}.open`, n) } catch {}
            return n
          })
          bump()
        }}
      >
        <span style={{ fg: pal().muted }}>{renderTick() >= 0 && open() ? "\u25bc " : "\u25b6 "}</span>
        <span style={{ fg: pal().primary }}>{t("panel.title")}</span>
        <Show when={showVersion()}><span style={{ fg: dimColor(pal().muted, 0.75) }}>{versionText}</span></Show>
        {anyEntry() ? (
          <>
            <span style={{ fg: pal().muted }}>{" ".repeat(spacerCols())}</span>
            <span style={{ fg: pal().success }}>{summaryParts()!.done}</span>
            {runningCount() > 0 && (
              <span style={{ fg: pal().warning }}> {summaryParts()!.running}</span>
            )}
            {errCount() > 0 && (
              <span style={{ fg: pal().error }}> {summaryParts()!.err}</span>
            )}
            {summaryParts()!.duration ? (
              <span style={{ fg: pal().muted }}> {summaryParts()!.duration}</span>
            ) : null}
            {summaryParts()!.cost ? (
              <span style={{ fg: pal().warning }}> {summaryParts()!.cost}</span>
            ) : null}
          </>
        ) : null}
      </text>

      {/* ── panel body ── */}
      <Show when={open()}>
        <text fg={pal().muted}>{sep()}</text>

        <Show
          when={anyEntry()}
          fallback={
            <text style={{ fg: pal().muted }}>
              {"  "}&gt; {t("status.none")}  {/* empty indent kept for visual balance */}
            </text>
          }
        >
          <box
            onMouseScroll={(e) => {
              if (props.scrollMode() === "click") return
              const total = entryList().length
              const m = max()
              if (total <= m) return
              const dir = e.button === 0 ? 1 : -1
              setScrollOffset((prev) => {
                const next = Math.max(0, Math.min(prev + dir, total - m))
                try { persistScroll(props.sessionId, next) } catch {}
                return next
              })
            }}
          >
            <Show when={hiddenAbove() > 0}>
              <text
                onMouseOver={() => setHoveredMoreAbove(true)}
                onMouseOut={() => setHoveredMoreAbove(false)}
                onMouseUp={() => {
                  const total = entryList().length
                  const m = max()
                  if (total <= m) return
                  const next = Math.max(0, scrollOffset() - m)
                  if (next === 0) {
                    setTimeout(() => {
                      setScrollOffset(next)
                      try { persistScroll(props.sessionId, next) } catch {}
                    }, 0)
                  } else {
                    setScrollOffset(next)
                    try { persistScroll(props.sessionId, next) } catch {}
                  }
                }}
              >
                <span style={{ fg: hoveredMoreAbove() ? pal().warning : pal().muted }}>
                  {"  "}&uarr; {hiddenAbove()} {t("scroll.more")}
                </span>
              </text>
            </Show>
            <For each={visibleList()}>
              {(entry) => {
              const isExpanded = () => expanded() === entry.id
              const isRunning = entry.status === "running"
              const isError = entry.status === "error"
              const elapsed = () => (entry.endedAt ?? now()) - entry.startedAt

              const statusDot = () => "\u25cf"
              const statusColor = () => {
                if (!isRunning) return isError ? pal().error : pal().success
                const t = (Math.sin(((now() % 2000) / 2000) * Math.PI * 2 - Math.PI / 2) + 1) / 2
                const a = rgb(pal().muted), b = rgb(pal().warning)
                if (!a || !b) return pal().warning
                const r = Math.round(a.r + (b.r - a.r) * t)
                const g = Math.round(a.g + (b.g - a.g) * t)
                const bl = Math.round(a.b + (b.b - a.b) * t)
                return "#" + [r, g, bl].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
              }

              const timeColor = () =>
                isRunning ? pal().warning : isError ? pal().error : pal().muted

              // Entry label: collapsed shows title only, expanded shows title only too
              const tokenText = () =>
                !isExpanded() && entry.tokens !== undefined && entry.tokens > 0
                  ? ` ${fmtTokens(entry.tokens!)}`
                  : ""
              const timeText = () =>
                !isExpanded() && (elapsed() >= 2000 || entry.endedAt !== undefined)
                  ? fmtDurationShort(elapsed(), isRunning)
                  : ""
              const suffixW = () => {
                let w = 0
                const t = timeText()
                if (t) w += 1 + visualWidth(t)
                const tk = tokenText()
                if (tk) w += visualWidth(tk)
                return w
              }
              const labelAvail = () => Math.max(6, panelWidth() - LEFT_PAD - suffixW())
              const labelText = () => {
                const max = labelAvail()
                const text = entry.title || entry.agent
                const truncated = truncate(text, max)
                const pad = Math.max(0, max - visualWidth(truncated))
                return truncated + " ".repeat(pad)
              }

              return (
                <>
                  {/* entry line — left-aligned */}
                  <text onMouseUp={() => toggleExpand(entry.id)}>
                    <span style={{ fg: pal().muted }}>
                      {isExpanded() ? "\u25bc" : "\u25b6"}
                    </span>
                    {" "}
                    <span style={{ fg: statusColor() }}>{statusDot()}</span>
                    {" "}
                    <span style={{ fg: pal().text }}>{labelText()}</span>
                    {timeText() ? (
                      <>
                        {" "}
                        <span style={{ fg: timeColor() }}>{timeText()}</span>
                      </>
                    ) : null}
                    {tokenText() ? (
                      <span style={{ fg: pal().muted }}>{tokenText()}</span>
                    ) : null}
                  </text>

                  {/* expanded detail — right-aligned values */}
                  <Show when={isExpanded()}>
                    <text>
                      {"  "}
                      <span style={{ fg: pal().primary }}>{t("agent.label")}: </span>
                      <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("agent.label")))}</span>
                      <span style={{ fg: pal().muted }}>{entry.agent}</span>
                    </text>
                    <text>
                      {"  "}
                      <span style={{ fg: pal().primary }}>{t("status.label")}: </span>
                      <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("status.label")))}</span>
                      <span style={{ fg: isRunning ? pal().warning : isError ? pal().error : pal().success }}>
                        {isRunning ? t("status.running") : isError ? t("status.error") : t("status.done")}
                      </span>
                    </text>
                    <Show when={elapsed() >= 2000 || entry.endedAt !== undefined}>
                      <text>
                        {"  "}
                        <span style={{ fg: pal().primary }}>{t("time.label")}: </span>
                        <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("time.label")))}</span>
                        <span style={{ fg: pal().muted }}>
                          {fmtDurationShort(elapsed(), isRunning)}
                        </span>
                      </text>
                    </Show>
                    <Show when={entry.tokens !== undefined}>
                      <text>
                        {"  "}
                        <span style={{ fg: pal().primary }}>{t("tokens.label")}: </span>
                        <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("tokens.label")))}</span>
                        <span style={{ fg: pal().muted }}>{fmtTokens(entry.tokens!)}</span>
                      </text>
                    </Show>
                    <Show when={entry.error}>
                      <text>
                        {"  "}
                        <span style={{ fg: pal().error }}>{t("error.label")}: </span>
                        <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("error.label")))}</span>
                        <span style={{ fg: pal().error }}>{truncate(String(entry.error), expandedValAvail())}</span>
                      </text>
                    </Show>
                    <Show when={entry.cost !== undefined}>
                      <text>
                        {"  "}
                        <span style={{ fg: pal().primary }}>{t("cost.label")}: </span>
                        <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("cost.label")))}</span>
                        <span style={{ fg: pal().muted }}>${entry.cost!.toFixed(4)}</span>
                      </text>
                    </Show>
                    <Show when={entry.model}>
                      <text>
                        {"  "}
                        <span style={{ fg: pal().primary }}>{t("model.label")}: </span>
                        <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("model.label")))}</span>
                        <span style={{ fg: pal().muted }}>{truncate(entry.model!, expandedValAvail())}</span>
                      </text>
                    </Show>
                    <Show when={entry.todoTotal !== undefined}>
                      <text>
                        {"  "}
                        <span style={{ fg: pal().primary }}>{t("todo.label")}: </span>
                        <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("todo.label")))}</span>
                        <span style={{ fg: pal().muted }}>{entry.todoDone}/{entry.todoTotal}</span>
                      </text>
                    </Show>
                    <Show when={entry.sessionId}>
                      <text
                        onMouseUp={() => {
                          if (entry.sessionId) {
                            props.api.ui.toast({
                              title: entry.title || entry.agent,
                              message: `${entry.sessionId}\n\n${t("session.toast.copy")}`,
                              duration: 8000,
                            })
                          }
                        }}
                      >
                        {"  "}
                        <span style={{ fg: pal().primary }}>{t("session.label")}: </span>
                        <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("session.label")))}</span>
                        <span style={{ fg: pal().muted }}>{truncate(entry.sessionId!, expandedValAvail() - visualWidth(" ⎘"))}</span>
                        <span style={{ fg: pal().warning }}> ⎘</span>
                      </text>
                    </Show>
                    {/* 进入会话 + 标记完成：同排左右两端，空间隔离防误触 */}
                    <Show when={entry.sessionId || isRunning}>
                      {(() => {
                        const dismissLabel = () => `- ${t("dismiss.label")}`
                        const openPrefix = () => "  \u2192 "
                        const openFull = () => entry.sessionId ? openPrefix() + t("open.label") : ""
                        const openW = () => entry.sessionId ? visualWidth(openFull()) : 0
                        const spacerW = () => Math.max(1, panelWidth() - openW() - visualWidth(dismissLabel()) - 2 /* indent */)
                        return (
                          <box flexDirection="row">
                            <Show when={entry.sessionId}
                              fallback={<text>{"  "}</text>}
                            >
                              <text
                                onMouseOver={() => setHoveredOpen(entry.id)}
                                onMouseOut={() => setHoveredOpen(undefined)}
                                onMouseUp={() => {
                                  if (entry.sessionId) {
                                    props.api.route.navigate("session", { sessionID: entry.sessionId })
                                  }
                                }}
                              >
                                <span style={{ fg: hoveredOpen() === entry.id ? pal().warning : pal().primary }}>{openPrefix()}</span>
                                <span style={{ fg: hoveredOpen() === entry.id ? pal().warning : pal().primary }}>{t("open.label")}</span>
                              </text>
                            </Show>
                            <Show when={isRunning}>
                              <>
                                <text style={{ fg: pal().muted }}>{" ".repeat(spacerW())}</text>
                                <text
                                  onMouseOver={() => setHoveredDismiss(entry.id)}
                                  onMouseOut={() => setHoveredDismiss(undefined)}
                                  onMouseUp={() => {
                                    upsertEntry({ id: entry.id, title: entry.title, agent: entry.agent, prompt: entry.prompt, status: "done" })
                                  }}
                                >
                                  <span style={{ fg: hoveredDismiss() === entry.id ? pal().warning : pal().muted }}>{dismissLabel()}</span>
                                </text>
                              </>
                            </Show>
                          </box>
                        )
                      })()}
                    </Show>
                  </Show>
                </>
              )
            }}
            </For>
            <Show when={hiddenBelow() > 0 || (props.sortOrder() === "desc" ? scrollOffset() > 0 : entryList().length > max() && clampedOffset() < entryList().length - max())}>
              {(() => {
                const showMore = hiddenBelow() > 0
                const showTop = props.sortOrder() === "desc"
                  ? scrollOffset() > 0
                  : entryList().length > max() && clampedOffset() < entryList().length - max()
                const left = showMore ? `  \u2193 ${hiddenBelow()} ${t("scroll.more")}` : "  "
                const right = props.sortOrder() === "desc"
                  ? `\u2191 ${t("scroll.top")}`
                  : `\u2193 ${t("scroll.bottom")}`
                const pad = showTop ? Math.max(1, panelWidth() - visualWidth(left) - visualWidth(right)) : 0
                return (
                  <box flexDirection="row">
                    <text
                      onMouseOver={() => showMore && setHoveredMoreBelow(true)}
                      onMouseOut={() => setHoveredMoreBelow(false)}
                      onMouseUp={() => {
                        if (!showMore) return
                        const total = entryList().length
                        const m = max()
                        if (total <= m) return
                        setScrollOffset((prev) => Math.min(total - m, prev + m))
                        try { persistScroll(props.sessionId, scrollOffset()) } catch {}
                        setHoveredMoreBelow(false)
                      }}
                    >
                      <span style={{ fg: showMore && hoveredMoreBelow() ? pal().warning : pal().muted }}>
                        {left}
                      </span>
                    </text>
                    {showTop ? (
                      <>
                        <text style={{ fg: pal().muted }}>{" ".repeat(pad)}</text>
                        <text
                          onMouseOver={() => setHoveredTop(true)}
                          onMouseOut={() => setHoveredTop(false)}
                          onMouseUp={() => {
                            const total = entryList().length
                            const m = max()
                            if (props.sortOrder() === "desc") {
                              setScrollOffset(0)
                            } else {
                              setScrollOffset(Math.max(0, total - m))
                            }
                            setHoveredTop(false)
                          }}
                        >
                          <span style={{ fg: hoveredTop() ? pal().warning : pal().muted }}>{right}</span>
                        </text>
                      </>
                    ) : null}
                  </box>
                )
              })()}
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}

// ===================================================================
// Plugin entry
// ===================================================================

interface SharedSignals {
  lang: () => Lang
  setLang: (l: Lang) => void
  maxEntries: () => number
  setMaxEntries: (n: number) => void
  sortOrder: () => SortOrder
  setSortOrder: (o: SortOrder) => void
  scrollMode: () => ScrollMode
  setScrollMode: (m: ScrollMode) => void
  sessionId: string
}

function createSidebarSlot(api: TuiPluginApi, sig: SharedSignals): TuiSlotPlugin {
  return {
    order: 60,
    slots: {
      sidebar_content(ctx: TuiSlotContext, input: { session_id: string }): JSX.Element {
        sig.sessionId = input.session_id
        return (
          <SubAgentPanel
            theme={ctx.theme.current}
            api={api}
            lang={sig.lang}
            maxEntries={sig.maxEntries}
            sortOrder={sig.sortOrder}
            scrollMode={sig.scrollMode}
            sessionId={input.session_id}
          />
        )
      },
    },
  }
}

const KV_PREFIX = "subagent_magazine"

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  // ── language ──
  const stored = String(api.kv.get(`${KV_PREFIX}.lang`, ""))
  const initialLang: Lang =
    stored === "zh" || stored === "en" ? stored : detectLang()
  const [lang, setLang] = createSignal<Lang>(initialLang)
  const [maxEntries, setMaxEntries] = createSignal(
    parseInt(String(api.kv.get(`${KV_PREFIX}.max_entries`, "10")), 10) || 10
  )
  const [sortOrder, setSortOrder] = createSignal<SortOrder>(
    String(api.kv.get(`${KV_PREFIX}.order`, "desc")) === "asc" ? "asc" : "desc"
  )
  const [scrollMode, setScrollMode] = createSignal<ScrollMode>(
    String(api.kv.get(`${KV_PREFIX}.scroll_mode`, "wheel")) === "click" ? "click" : "wheel"
  )

  const signals: SharedSignals = { lang, setLang, maxEntries, setMaxEntries, sortOrder, setSortOrder, scrollMode, setScrollMode, sessionId: "" }

  api.slots.register(createSidebarSlot(api, signals))

  // ── slash command: /subagent-lang ──
  api.command?.register(() => [
    {
      title: "SubAgent Magazine: Language",
      value: "subagent-lang",
      description: "Switch display language (中文 / English)",
      slash: { name: "subagent-lang" },
      onSelect: (dialog) => {
        dialog?.replace(() => (
          <api.ui.DialogSelect
            title="Language / 语言"
            options={[
              { title: "中文", value: "zh" },
              { title: "English", value: "en" },
            ]}
            onSelect={(opt) => {
              const l = opt.value as Lang
              setLang(l)
              api.kv.set(`${KV_PREFIX}.lang`, l)
              api.ui.toast({
                message: l === "zh" ? "语言: 中文" : "Language: English",
              })
              dialog?.clear()
            }}
          />
        ))
      },
    },
    {
      title: "SubAgent Magazine: Sort Order",
      value: "subagent-order",
      description: "Set sub-agent entry sort order (desc / asc)",
      slash: { name: "subagent-order" },
      onSelect: (dialog) => {
        const t = (k: string) => I18N[lang()][k] ?? k
        dialog?.replace(() => (
          <api.ui.DialogSelect
            title="Sort Order / 排序方式"
            options={[
              { title: t("order.desc"), value: "desc" },
              { title: t("order.asc"), value: "asc" },
            ]}
            onSelect={(opt) => {
              const o = opt.value as SortOrder
              setSortOrder(o)
              api.kv.set(`${KV_PREFIX}.order`, o)
              api.ui.toast({
                message: o === "desc" ? t("order.desc") : t("order.asc"),
              })
              dialog?.clear()
            }}
          />
        ))
      },
    },
    {
      title: "SubAgent Magazine: Scroll Mode",
      value: "subagent-scroll",
      description: "Set scroll mode (wheel / click)",
      slash: { name: "subagent-scroll" },
      onSelect: (dialog) => {
        const t = (k: string) => I18N[lang()][k] ?? k
        dialog?.replace(() => (
          <api.ui.DialogSelect
            title="Scroll Mode / 滚动模式"
            options={[
              { title: t("scroll.wheel"), value: "wheel" },
              { title: t("scroll.click"), value: "click" },
            ]}
            onSelect={(opt) => {
              const m = opt.value as ScrollMode
              setScrollMode(m)
              api.kv.set(`${KV_PREFIX}.scroll_mode`, m)
              api.ui.toast({
                message: m === "wheel" ? t("scroll.wheel") : t("scroll.click"),
              })
              dialog?.clear()
            }}
          />
        ))
      },
    },
    {
      title: "SubAgent Magazine: Max Entries",
      value: "subagent-max",
      description: "Set max visible sub-agent entries in sidebar",
      slash: { name: "subagent-max" },
      onSelect: (dialog) => {
        dialog?.replace(() => (
          <api.ui.DialogPrompt
            title="Max Visible Entries"
            description={() => (
              <text>Number of entries to show in the sidebar (1–50)</text>
            )}
            value={String(maxEntries())}
            onConfirm={(val) => {
              const n = Math.max(1, Math.min(50, parseInt(val, 10) || 10))
              setMaxEntries(n)
              api.kv.set(`${KV_PREFIX}.max_entries`, n)
              api.ui.toast({ message: `Max entries: ${n}` })
              dialog?.clear()
            }}
          />
        ))
      },
    },
    {
      title: "SubAgent Magazine: Version",
      value: "subagent-version",
      description: "Show plugin version",
      slash: { name: "subagent-version" },
      onSelect: (dialog) => {
        api.ui.toast({ message: `opencode-subagent-magazine v${PLUGIN_VERSION}` })
        dialog?.clear()
      },
    },
    {
      title: "SubAgent Magazine: Session",
      value: "subagent-session",
      description: "Show current session ID",
      slash: { name: "subagent-session" },
      onSelect: (dialog) => {
        api.ui.toast({ message: `Session: ${signals.sessionId}` })
        dialog?.clear()
      },
    },
    {
      title: "SubAgent Magazine: Clear Running",
      value: "subagent-clear-running",
      description: "Mark all running sub-agent entries as done (for stuck/zombie entries)",
      slash: { name: "subagent-clear-running" },
      onSelect: (dialog) => {
        const sid = signals.sessionId
        const entries = globalEntryCache.get(sid)
        if (!entries || entries.size === 0) {
          const msg = signals.lang() === "zh" ? "暂无子代理条目" : "No sub-agent entries found"
          api.ui.toast({ message: msg })
          dialog?.clear()
          return
        }
        let count = 0
        for (const [, entry] of entries) {
          if (entry.status === "running") {
            entry.status = "done" as SubStatus
            entry.endedAt = Date.now()
            count++
          }
        }
        if (count > 0) {
          // 立即写 KV
          try {
            const data = JSON.parse(String(api.kv.get(`${KV_PREFIX}.session_data`, "{}")))
            const sessionObj = api.state.session.get(sid)
            const parentID = (sessionObj as any)?.parentID as string | undefined
            if (parentID) {
              if (!data[parentID]) data[parentID] = { ts: Date.now(), entries: [], scroll: 0, expanded: "", children: {} }
              if (!data[parentID].children) data[parentID].children = {}
              if (!data[parentID].children[sid]) data[parentID].children[sid] = { scroll: 0, expanded: "", entries: [] }
              data[parentID].children[sid] = { ...data[parentID].children[sid], entries: [...entries.values()] }
            } else {
              data[sid] = {
                ts: Date.now(),
                entries: [...entries.values()],
                scroll: data[sid]?.scroll ?? 0,
                expanded: data[sid]?.expanded ?? "",
                children: data[sid]?.children ?? {},
              }
            }
            api.kv.set(`${KV_PREFIX}.session_data`, JSON.stringify(data))
          } catch {}
          const msg = signals.lang() === "zh"
            ? `已标记 ${count} 个运行中的条目为完成`
            : `Marked ${count} running entries as done`
          api.ui.toast({ message: msg })
        } else {
          const msg = signals.lang() === "zh"
            ? "没有需要清理的运行中条目"
            : "No running entries to clear"
          api.ui.toast({ message: msg })
        }
        dialog?.clear()
      },
    },
    {
      title: "SubAgent Magazine: TTL",
      value: "subagent-ttl",
      description: "Set session data retention period (days before auto-cleanup)",
      slash: { name: "subagent-ttl" },
      onSelect: (dialog) => {
        const t = (k: string) => I18N[signals.lang()][k] ?? k
        dialog?.replace(() => (
          <api.ui.DialogSelect
            title={t("ttl.label")}
            options={[
              { title: t("ttl.3d"), value: "3" },
              { title: t("ttl.7d"), value: "7" },
              { title: t("ttl.14d"), value: "14" },
              { title: t("ttl.30d"), value: "30" },
            ]}
            onSelect={(opt) => {
              const days = parseInt(opt.value, 10)
              api.kv.set(`${KV_PREFIX}.ttl_days`, String(days))
              const msg = t("ttl.toast").replace("{n}", String(days))
              api.ui.toast({ message: msg })
              dialog?.clear()
            }}
          />
        ))
      },
    },
    {
      title: "SubAgent Magazine: Clear Entries",
      value: "subagent-clear-entries",
      description: "Delete all sub-agent records for the current session (cannot be undone)",
      slash: { name: "subagent-clear-entries" },
      onSelect: (dialog) => {
        const t = (k: string) => I18N[signals.lang()][k] ?? k
        const sid = signals.sessionId
        const sessionObj = api.state.session.get(sid)
        const parentID = (sessionObj as any)?.parentID as string | undefined
        dialog?.replace(() => (
          <api.ui.DialogConfirm
            title={t("clear.title")}
            message={t("clear.prompt")}
            onConfirm={() => {
              try {
                const data = JSON.parse(String(api.kv.get(`${KV_PREFIX}.session_data`, "{}")))
                let count = 0
                if (parentID) {
                  if (data[parentID]?.children?.[sid]) {
                    const child = data[parentID].children[sid]
                    const ids = child.entries?.map((e: any) => e.id) ?? []
                    count = ids.length
                    child.entries = []
                    child.scroll = 0
                    child.expanded = ""
                    child.clearedIds = [...new Set([...(child.clearedIds ?? []), ...ids])]
                  }
                } else {
                  count = data[sid]?.entries?.length ?? 0
                  if (data[sid]) {
                    const ids = data[sid].entries?.map((e: any) => e.id) ?? []
                    data[sid].entries = []
                    data[sid].scroll = 0
                    data[sid].expanded = ""
                    data[sid].clearedIds = [...new Set([...(data[sid].clearedIds ?? []), ...ids])]
                  }
                }
                api.kv.set(`${KV_PREFIX}.session_data`, JSON.stringify(data))
                globalEntryCache.delete(sid)
                setClearTick((v) => v + 1)
                const msg = t("clear.done").replace("{n}", String(count))
                api.ui.toast({ message: msg })
              } catch {}
              dialog?.clear()
            }}
          />
        ))
      },
    },
  ])
}

const mod: TuiPluginModule & { id: string } = {
  id: "opencode-subagent-magazine",
  tui,
}

export default mod
