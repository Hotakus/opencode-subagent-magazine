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
    "time.label": "耗时",
    "tokens.label": "上下文",
    "error.label": "错误",
    "model.label": "模型",
    "todo.label": "进度",
    "open.label": "进入会话",
    "cost.label": "费用",
    "scroll.more": "更多",
    "scroll.top": "回顶",
  },
  en: {
    "panel.title": "SubAgent",
    "status.none": "No sub-agents yet",
    "agent.label": "agent",
    "time.label": "time",
    "tokens.label": "tokens",
    "error.label": "error",
    "model.label": "model",
    "todo.label": "todo",
    "open.label": "Open session",
    "cost.label": "cost",
    "scroll.more": "more",
    "scroll.top": "Top",
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

// 模块级缓存：保留各 session 的最新 entryMap，不随组件内 session 切换而丢失。
// 当用户在子 session 内部时，handleSessionEnd 可通过此缓存找到父 session 的 entries。
const globalEntryCache = new Map<string, Map<string, SubEntry>>()

function SubAgentPanel(props: {
  theme: TuiThemeCurrent
  api: TuiPluginApi
  lang: () => Lang
  maxEntries: () => number
  sessionId: string
}): JSX.Element {
  const t = (key: string) => I18N[props.lang()][key] ?? key

  // ── session data (single-key, true deletion on cleanup) ──
  const SESSION_DATA_KEY = `${KV_PREFIX}.session_data`
  const TTL_MS = 3 * 24 * 60 * 60 * 1000

  interface SessionRecord {
    ts: number
    entries: SubEntry[]
    scroll: number
    expanded: string
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

  const loadEntries = (sid: string): Map<string, SubEntry> => {
    const m = new Map<string, SubEntry>()
    try {
      const rec = loadSessionData()[sid]
      if (rec?.entries) {
        for (const e of rec.entries) m.set(e.id, e)
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
        data[sid] = { ...data[sid], ts: Date.now(), entries: [...entries.values()] }
        saveSessionData(data)
      } catch {}
    }, 200)
  }

  const persistScroll = (sid: string, scroll: number) => {
    try {
      const data = loadSessionData()
      data[sid] = { ...data[sid], ts: Date.now(), scroll }
      saveSessionData(data)
    } catch {}
  }

  const persistExpanded = (sid: string, expanded: string) => {
    try {
      const data = loadSessionData()
      data[sid] = { ...data[sid], ts: Date.now(), expanded }
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

      // 检测是否有 entry 从 running 变为 done/error → 立即写 KV
      // 避免 session 切换时 KV 仍是旧状态，导致 scan 用 Date.now() 覆盖正确的 endedAt
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
          data[props.sessionId] = { ...data[props.sessionId], ts: Date.now(), entries: [...next.values()] }
          saveSessionData(data)
        } catch {}
      } else {
        persistEntries(props.sessionId, next)
      }

      // 同步到全局缓存，确保跨 session 查找时数据可用
      globalEntryCache.set(props.sessionId, new Map(next))

      return next
    })
  }

  const [panelWidth, setPanelWidth] = createSignal(28)
  const [open, setOpen] = createSignal(
    (() => { try { return props.api.kv.get(`${KV_PREFIX}.open`, true) as boolean } catch { return true } })()
  )
  const [expanded, setExpanded] = createSignal<string | undefined>(
    (() => { try { return loadSessionData()[props.sessionId]?.expanded || undefined } catch { return undefined } })()
  )
  const [hoveredOpen, setHoveredOpen] = createSignal<string | undefined>(undefined)
  const [hoveredTop, setHoveredTop] = createSignal(false)
  const [scrollOffset, setScrollOffset] = createSignal(
    (() => { try { return loadSessionData()[props.sessionId]?.scroll ?? 0 } catch { return 0 } })()
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

    // 跨 session 完成事件：用户正在查看子 session 内部时，其他子代理 done。
    // 上面的 setEntryMap 在子 session 的 entries 中找不到父 session 的 entry。
    // 通过全局缓存（切换前保留的父 session entries）查找并更新，再同步回 KV。
    try {
      const sessionObj = props.api.state.session.get(sid)
      const parentSid = sessionObj?.parentID
      if (parentSid && parentSid !== props.sessionId) {
        // 优先全局缓存——切换 session 时不会被替换，始终保留父 session 的最新 entries
        const parentCache = globalEntryCache.get(parentSid)
        const nowTs = Date.now()
        let found = false

        if (parentCache) {
          found = tryMatchAndUpdate(parentCache, sid, status, nowTs)
        }

        // 缓存未命中时回退到 KV（极端情况：session 切换前缓存未建立）
        if (!found) {
          const data = loadSessionData()
          const rec = data[parentSid]
          if (rec?.entries) {
            const fallbackMap = new Map(rec.entries.map((e: SubEntry) => [e.id, e]))
            found = tryMatchAndUpdate(fallbackMap, sid, status, nowTs)
            if (found) {
              // 回退命中了也要写回 KV，并回填缓存
              data[parentSid] = { ...rec, ts: nowTs, entries: [...fallbackMap.values()] }
              saveSessionData(data)
              globalEntryCache.set(parentSid, fallbackMap)
            }
          }
        }

        // KV 同步：以全局缓存（最新的内存状态）为准写回 KV
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
        if (switched) {
          const saved = loadSessionData()[sid]?.scroll ?? 0
          setScrollOffset(saved)
        }
        // scan uses setEntryMapRaw — ephemeral data, not persisted to kv.
        // Only event-driven changes (handlePartUpdated, handleSessionEnd) persist.
        setEntryMapRaw((prev) => {
          // 优先全局缓存——handleSessionEnd 修复2 已同步更新，无 KV 读写延迟
          const next = switched
            ? new Map(globalEntryCache.get(sid) ?? loadEntries(sid))
            : new Map(prev)
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
    return [...entryMap().values()].sort((a, b) => b.startedAt - a.startedAt)
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
      t("agent.label"), t("time.label"), t("tokens.label"),
      t("error.label"), t("cost.label"), t("model.label"), t("todo.label"),
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
              <text style={{ fg: pal().muted }}>
                {"  "}&uarr; {hiddenAbove()} {t("scroll.more")}
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
                        onMouseOver={() => setHoveredOpen(entry.id)}
                        onMouseOut={() => setHoveredOpen(undefined)}
                        onMouseUp={() => {
                          if (entry.sessionId) {
                            props.api.route.navigate("session", { sessionID: entry.sessionId })
                          }
                        }}
                      >
                        {"  "}
                        <span style={{ fg: hoveredOpen() === entry.id ? pal().warning : pal().primary }}>{"\u2192 "}</span>
                        <span style={{ fg: hoveredOpen() === entry.id ? pal().warning : pal().primary }}>{t("open.label")}</span>
                      </text>
                    </Show>
                  </Show>
                </>
              )
            }}
            </For>
            <Show when={hiddenBelow() > 0 || scrollOffset() > 0}>
              {(() => {
                const showMore = hiddenBelow() > 0
                const showTop = scrollOffset() > 0
                const left = showMore ? `  \u2193 ${hiddenBelow()} ${t("scroll.more")}` : "  "
                const right = `\u2191 ${t("scroll.top")}`
                const pad = showTop ? Math.max(1, panelWidth() - visualWidth(left) - visualWidth(right)) : 0
                return (
                  <box flexDirection="row">
                    <text style={{ fg: pal().muted }}>{left}</text>
                    {showTop ? (
                      <>
                        <text style={{ fg: pal().muted }}>{" ".repeat(pad)}</text>
                        <text
                          onMouseOver={() => setHoveredTop(true)}
                          onMouseOut={() => setHoveredTop(false)}
                          onMouseUp={() => { setScrollOffset(0); setHoveredTop(false) }}
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

  const signals: SharedSignals = { lang, setLang, maxEntries, setMaxEntries, sessionId: "" }

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
  ])
}

const mod: TuiPluginModule & { id: string } = {
  id: "opencode-subagent-magazine",
  tui,
}

export default mod
