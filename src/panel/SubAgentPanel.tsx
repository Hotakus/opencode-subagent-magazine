/** @jsxImportSource @opentui/solid */

import type { JSX } from "@opentui/solid"
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
import { PLUGIN_VERSION } from "../_version"
import { copyText } from "../clipboard"
import { createT } from "../i18n"
import type { Lang, SortOrder, ScrollMode, SubEntry, SubStatus, SessionRecord, TimeFormat } from "../core/types"
import { SUBAGENT_TOOLS } from "../core/types"
import { visualWidth, truncate, fmtDuration, fmtTokens, safeErrorMsg } from "../core/format"
import { rgb, desaturateTo, dimColor, FALLBACK, MAX_SAT } from "../core/color"
import { KV_PREFIX, updateSessionData } from "../core/kv"
import type { PanelApi, PanelEvent } from "./panel-api"
import { globalEntryCache, clearTick } from "./store"
import { isDirectChildSession } from "./session-routing"
import { findSubEntryKey, mergeSubEntries, upsertSubEntry } from "./entry-map"

/** Entry line left prefix: icon + space + status dot + space */
const LEFT_PAD = 4
/** Detail row indent: two spaces */
const INDENT = 2
// ===================================================================
// Sidebar component
// ===================================================================

/** 读取 part/state 两级的 tool metadata（TUI 数据层放在 part 级，旧形状嵌在 state 里）。 */
function partMetadata(
  part: Record<string, any>,
  st: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const partMeta = part?.metadata as Record<string, unknown> | undefined
  if (partMeta && Object.keys(partMeta).length > 0) return partMeta
  const stateMeta = st?.metadata as Record<string, unknown> | undefined
  return stateMeta && Object.keys(stateMeta).length > 0 ? stateMeta : undefined
}

export function SubAgentPanel(props: {
  api: PanelApi
  theme: Record<string, unknown>
  lang: () => Lang
  maxEntries: () => number
  sortOrder: () => SortOrder
  scrollMode: () => ScrollMode
  borderVisible: () => boolean
  showEntryCost: () => boolean
  showEntryTime: () => boolean
  showEntryTokens: () => boolean
  timeFormat: () => TimeFormat
  sessionId: string
}): JSX.Element {
  const t = createT(() => props.lang())

  // ── session data (single-key, true deletion on cleanup) ──
  const SESSION_DATA_KEY = `${KV_PREFIX}.session_data`
  const ttlDaysRaw = parseInt(String(props.api.kv.get(`${KV_PREFIX}.ttl_days`, "3")), 10)
  const ttlDays = Number.isNaN(ttlDaysRaw) ? 3 : ttlDaysRaw
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

  /**
   * 持久化存储的原子 read-merge-write：所有写入都经过这里。
   * 多个 TUI 共用一个 KV 文件时，直接写入内存快照
   * 会丢掉其他实例创建的条目。
   */
  const mutateSessionData = (mutator: (data: Record<string, SessionRecord>) => void) => {
    // 宿主存储可能异步 reject；吞掉以免失败写入变成未处理 rejection 拖垮 TUI。
    void Promise.resolve(updateSessionData(props.api.kv, mutator)).catch(() => {})
  }

  /** 带合理默认值的 SessionRecord（记录可能在首次写入时创建）。 */
  const ensureRootRecord = (data: Record<string, SessionRecord>, sid: string): SessionRecord => {
    const rec = data[sid]
    if (rec) return rec
    const created: SessionRecord = { ts: Date.now(), entries: [], scroll: 0, expanded: "", children: {} }
    data[sid] = created
    return created
  }

  const ensureChildRecord = (
    data: Record<string, SessionRecord>,
    parentSid: string,
    sid: string,
  ): ChildRecord => {
    const parent = ensureRootRecord(data, parentSid)
    if (!parent.children) parent.children = {}
    if (!parent.children[sid]) parent.children[sid] = { scroll: 0, expanded: "", entries: [] }
    return parent.children[sid]
  }

  /** 将任意 session ID 解析为父会话 ID + 是否子会话。
   *  通过 SDK session.get(sid).parentID 判断，无 parentID 即为主会话。 */
  const resolveParent = (sid: string): { parentSid: string; isChild: boolean } => {
    try {
      const session = props.api.session.get(sid)
      const parentID = (session as any)?.parentID as string | undefined
      if (parentID) return { parentSid: parentID, isChild: true }
    } catch {}
    return { parentSid: sid, isChild: false }
  }

  const loadEntries = (sid: string): Map<string, SubEntry> => {
    let m = new Map<string, SubEntry>()
    try {
      const { parentSid, isChild } = resolveParent(sid)
      const rec = loadSessionData()[parentSid]
      if (rec) {
        const source = isChild ? rec.children?.[sid]?.entries : rec.entries
        if (source) {
          for (const e of source) {
            m = upsertSubEntry(m, e)
          }
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
        mutateSessionData((data) => {
          const { parentSid, isChild } = resolveParent(sid)
          if (isChild) {
            const parent = ensureRootRecord(data, parentSid)
            const child = ensureChildRecord(data, parentSid, sid)
            child.entries = [...mergeSubEntries(child.entries ?? [], entries.values()).values()]
            parent.ts = Date.now()
          } else {
            const rec = ensureRootRecord(data, sid)
            rec.ts = Date.now()
            rec.entries = [...mergeSubEntries(rec.entries ?? [], entries.values()).values()]
          }
        })
      } catch {}
    }, 200)
  }

  const persistScroll = (sid: string, scroll: number) => {
    try {
      mutateSessionData((data) => {
        const { parentSid, isChild } = resolveParent(sid)
        if (isChild) {
          ensureChildRecord(data, parentSid, sid).scroll = scroll
        } else {
          const rec = ensureRootRecord(data, sid)
          rec.ts = Date.now()
          rec.scroll = scroll
        }
      })
    } catch {}
  }

  const persistExpanded = (sid: string, expanded: string) => {
    try {
      mutateSessionData((data) => {
        const { parentSid, isChild } = resolveParent(sid)
        if (isChild) {
          ensureChildRecord(data, parentSid, sid).expanded = expanded
        } else {
          const rec = ensureRootRecord(data, sid)
          rec.ts = Date.now()
          rec.expanded = expanded
        }
      })
    } catch {}
  }

  const cleanupOldSessions = () => {
    if (ttlDays <= 0) return  // 无期限，跳过清理
    try {
      const cutoff = Date.now() - TTL_MS
      mutateSessionData((data) => {
        for (const sid of Object.keys(data)) {
          if (data[sid].ts < cutoff) delete data[sid]
        }
      })
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
        if (prevEntry?.status === "running" && (entry.status === "done" || entry.status === "error" || entry.status === "cancelled")) {
          needsImmediateFlush = true
          break
        }
      }

      if (needsImmediateFlush) {
        clearTimeout(persistTimer)
        try {
          mutateSessionData((data) => {
            const { parentSid, isChild } = resolveParent(props.sessionId)
            if (isChild) {
              const parent = ensureRootRecord(data, parentSid)
              const child = ensureChildRecord(data, parentSid, props.sessionId)
              child.entries = [...mergeSubEntries(child.entries ?? [], next.values()).values()]
              parent.ts = Date.now()
            } else {
              const rec = ensureRootRecord(data, props.sessionId)
              rec.ts = Date.now()
              rec.entries = [...mergeSubEntries(rec.entries ?? [], next.values()).values()]
            }
          })
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
  const [hoveredCancel, setHoveredCancel] = createSignal<string | undefined>(undefined)
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

  // ── upsert ──
  const upsertEntry = (
    partial: Omit<SubEntry, "startedAt" | "endedAt"> & { startedAt?: number }
  ) => {
    setEntryMap((prev) => upsertSubEntry(prev, partial))
  }

  // ── cancel helpers ──
  const isDescendantOf = (childId: string, rootId: string): boolean => {
    const visited = new Set<string>()
    try {
      let current = props.api.session.get(childId) as any
      while (current?.parentID) {
        if (visited.has(current.id)) return false
        visited.add(current.id)
        if (current.parentID === rootId) return true
        current = props.api.session.get(current.parentID) as any
      }
    } catch {}
    return false
  }

  const settleOnIdle = (entry: SubEntry): SubStatus => {
    if (entry.status === "cancel_requested" && entry.abortAccepted) return "cancelled"
    return "done"
  }

  const cancelEntry = async (entry: SubEntry) => {
    const childId = entry.sessionId
    if (!childId) {
      props.api.ui.toast(t("cancel.label") + ": " + t("cancel.no_session"), { title: entry.title || entry.agent })
      return
    }

    try {
      const child = props.api.session.get(childId) as any
      if (!child?.parentID) {
        props.api.ui.toast(t("cancel.label") + ": " + t("cancel.not_child"), { title: entry.title || entry.agent })
        return
      }
    } catch {
      props.api.ui.toast(t("cancel.label") + ": " + t("cancel.read_error"), { title: entry.title || entry.agent })
      return
    }

    if (!isDescendantOf(childId, props.sessionId)) {
      props.api.ui.toast(t("cancel.label") + ": " + t("cancel.outside_tree"), { title: entry.title || entry.agent })
      return
    }

    try {
      const st = props.api.session.status(childId)
      if (st?.type !== "busy") {
        const tokens = props.api.usage.readSessionTokens(childId)
        const cost = props.api.usage.readSessionCost(childId)
        upsertEntry({
          id: entry.id, title: entry.title, agent: entry.agent, prompt: entry.prompt,
          status: "done", sessionId: entry.sessionId,
          tokens, cost,
        })
        return
      }
    } catch {
      props.api.ui.toast(t("cancel.label") + ": " + t("cancel.status_error"), { title: entry.title || entry.agent })
      return
    }

    upsertEntry({
      id: entry.id, title: entry.title, agent: entry.agent, prompt: entry.prompt,
      status: "cancel_requested", sessionId: entry.sessionId,
      cancelRequestedAt: Date.now(), abortAccepted: false, cancelReason: "manual",
    } as any)

    try {
      await props.api.client.abort({ sessionID: childId })
      upsertEntry({
        id: entry.id, title: entry.title, agent: entry.agent, prompt: entry.prompt,
        status: "cancel_requested", sessionId: entry.sessionId,
        abortAccepted: true,
      } as any)
      props.api.ui.toast(t("cancel.label") + ": " + t("cancel.sent"))
    } catch (err) {
      upsertEntry({
        id: entry.id, title: entry.title, agent: entry.agent, prompt: entry.prompt,
        status: "error", sessionId: entry.sessionId,
        error: String(err),
      })
      props.api.ui.toast(t("cancel.label") + ": " + t("cancel.failed"), { title: entry.title || entry.agent })
    }
  }

  // ── event handlers ──
  const handlePartUpdated = (event: PanelEvent) => {
    const part = event.payload?.part as Record<string, unknown> | undefined
    if (!part) return

    // V2 事件流是全局的——若 payload 带发起会话 ID，则只归账到正在查看的会话，
    // 避免其他会话的子代理写进当前侧边栏；V1 宿主已按会话 scope，不传 sessionID。
    const eventSid = event.payload?.sessionID !== undefined ? String(event.payload.sessionID) : undefined
    if (event.scope === "global" && eventSid !== props.sessionId) {
      return
    }

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
        const stMeta = partMetadata(part as Record<string, any>, st)
        const errorSid = stMeta?.session_id !== undefined ? String(stMeta.session_id)
          : stMeta?.sessionId !== undefined ? String(stMeta.sessionId)
          : undefined
        const key = findSubEntryKey(entryMap(), id, errorSid)
        const existing = key ? entryMap().get(key) : undefined
        if (existing) {
          upsertEntry({
            id: existing.id,
            title: existing.title,
            agent: existing.agent,
            prompt: existing.prompt,
            sessionId: existing.sessionId ?? errorSid,
            status: "error",
          })
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
      if ((input?.run_in_background === true || input?.background === true) && status === "done") {
        const stMetaCheck = partMetadata(part as Record<string, any>, st)
        const hasChild = stMetaCheck?.session_id !== undefined || stMetaCheck?.sessionId !== undefined
        if (hasChild) status = "running"
      }

      const agent = String((part as any).subagent_type ?? input?.agent ?? input?.subagent_type ?? input?.category ?? tool)
      const prompt = String(input?.prompt ?? (part as any).description ?? "")
      const desc = input?.description !== undefined ? String(input.description) : ""
      const title = desc || truncate(prompt.replace(/\n/g, " ").replace(/\s+/g, " ").trim(), 40)

      const id = `tool:${String(part.id ?? crypto.randomUUID())}`
      // Child session ID lives in state-level metadata (ToolStateCompleted.metadata),
      // injected by the tool executor.  ToolPart.sessionID is the parent session.
      const stMeta = partMetadata(part as Record<string, any>, st)
      const subSid = stMeta?.session_id !== undefined ? String(stMeta.session_id)
        : stMeta?.sessionId !== undefined ? String(stMeta.sessionId)
        : undefined
      upsertEntry({ id, title, agent, prompt, sessionId: subSid, status })
    }
  }

  const handleSessionEnd = (event: PanelEvent, status: SubStatus) => {
    const props_ = event.payload
    const sid = String(props_?.sessionID ?? "")
    if (!sid) return

    const isGlobalEvent = event.scope === "global"
    let eventSession: ReturnType<PanelApi["session"]["get"]>
    if (isGlobalEvent) {
      try { eventSession = props.api.session.get(sid) } catch { eventSession = undefined }
    }
    const isCurrentChild = !isGlobalEvent || isDirectChildSession(props.sessionId, sid, eventSession)

    const sessionTokens = props.api.usage.readSessionTokens(sid)
    const sessionCost = props.api.usage.readSessionCost(sid)
    const sessionModel = props.api.usage.readSessionModel(sid)
    const sessionTodo = props.api.usage.readSessionTodo(sid)
    let sessionAgent: string | undefined
    let errorMsg: string | undefined
    try {
      const s = props.api.session.get(sid)
      sessionAgent = s?.agent
      if (status === "error") {
        const evtErr = props_?.error as Record<string, unknown> | undefined
        errorMsg = safeErrorMsg(evtErr) || safeErrorMsg(props_?.message)
        if (!errorMsg) {
          const msgs = props.api.session.messages(sid)
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
      // 精确匹配：sessionId 对得上 + 状态为 running / cancel_requested
      for (const [, entry] of entriesMap) {
        if (entry.sessionId === targetSid && (entry.status === "running" || entry.status === "cancel_requested")) {
          const finalStatus = targetStatus === "error" ? "error" : settleOnIdle(entry)
          entry.status = finalStatus
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
      // 回退：sessionId 未关联但 agent 名匹配 + 状态为 running / cancel_requested
      if (sessionAgent) {
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "")
        const saNorm = normalize(sessionAgent)
        let best: { entry: SubEntry; gap: number } | null = null
        for (const [, entry] of entriesMap) {
          if (entry.status !== "running" && entry.status !== "cancel_requested") continue
          const eaNorm = normalize(entry.agent)
          if (!eaNorm || !saNorm) continue
          if (!eaNorm.includes(saNorm) && !saNorm.includes(eaNorm)) continue
          const gap = nowTs - (entry.startedAt || 0)
          if (!best || gap > best.gap) best = { entry, gap }
        }
        if (!best) {
          for (const [, entry] of entriesMap) {
            if (entry.status !== "running" && entry.status !== "cancel_requested") continue
            if (entry.sessionId) continue
            const gap = nowTs - (entry.startedAt || 0)
            if (!best || gap > best.gap) best = { entry, gap }
          }
        }
        if (best) {
          const finalStatus = targetStatus === "error" ? "error" : settleOnIdle(best.entry)
          best.entry.status = finalStatus
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
        if (!isCurrentChild || entry.sessionId !== sid) continue
        if (entry.status !== "running" && entry.status !== "done" && entry.status !== "cancel_requested") continue
        // Skip parent session idle — subagent entries belong to child sessions only
        if (sid === props.sessionId) continue
        // For "done" entries (sync tasks completed before session.idle), only backfill tokens/cost
        const alreadySettled = entry.status !== "running" && entry.status !== "cancel_requested"
        const finalStatus = status === "error" ? "error" : settleOnIdle(entry)
        next.set(id, {
          ...entry,
          ...(alreadySettled ? {} : { status: finalStatus, endedAt: Date.now() }),
          tokens: entry.tokens ?? sessionTokens,
          cost: entry.cost ?? sessionCost,
          model: entry.model ?? sessionModel,
          todoTotal: entry.todoTotal ?? sessionTodo?.total,
          todoDone: entry.todoDone ?? sessionTodo?.done,
          error: errorMsg || entry.error,
        })
        changed = true
      }
      if (!changed && sessionAgent && isCurrentChild) {
        const nowTs = Date.now()
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "")
        const saNorm = normalize(sessionAgent)
        let best: { id: string; gap: number } | null = null

        // Phase 1: try matching by agent name（agent 名有交集）
        for (const [id, entry] of next) {
          if (entry.status !== "running" && entry.status !== "cancel_requested") continue
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
            if (entry.status !== "running" && entry.status !== "cancel_requested") continue
            if (entry.sessionId) continue
            const gap = nowTs - (entry.startedAt || 0)
            if (!best || gap > best.gap) best = { id, gap }
          }
        }

        if (best) {
          const entry = next.get(best.id)!
          const finalStatus = status === "error" ? "error" : settleOnIdle(entry)
          next.set(best.id, {
            ...entry, status: finalStatus, endedAt: nowTs,
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
      const parentSid = (isGlobalEvent ? eventSession : props.api.session.get(sid))?.parentID
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
          if (rec?.entries?.length) {
            const fallbackMap = new Map(rec.entries.map((e: SubEntry) => [e.id, e]))
            found = tryMatchAndUpdate(fallbackMap, sid, status, nowTs)
            if (found) {
              // 回退命中后写入 KV 并回填缓存。
              // merge（而非整表替换）：其他实例写入的新条目不能被旧缓存覆盖。
              globalEntryCache.set(parentSid, fallbackMap)
              mutateSessionData((latest) => {
                const latestRec = latest[parentSid]
                latest[parentSid] = {
                  ...(latestRec ?? rec),
                  ts: nowTs,
                  entries: [...mergeSubEntries(latestRec?.entries ?? [], fallbackMap.values()).values()],
                }
              })
            }
          }
        }

        // 将模块级缓存中的最新状态 merge 进 KV（缓存可能缺少其他实例的新条目）
        if (found && parentCache) {
          mutateSessionData((data) => {
            const rec = data[parentSid]
            data[parentSid] = {
              ...(rec ?? { entries: [], scroll: 0, expanded: "", children: {}, ts: nowTs }),
              ts: nowTs,
              entries: [...mergeSubEntries(rec?.entries ?? [], parentCache.values()).values()],
            }
          })
        }
      }
    } catch {}

    // Delayed backfill: re-read data after state sync catches up, to capture the final
    // token/cost values that may not have been available when session.idle fired.
    setTimeout(() => {
      if (disposed) return
      const finalTokens = props.api.usage.readSessionTokens(sid)
      const finalCost = props.api.usage.readSessionCost(sid)
      const finalModel = props.api.usage.readSessionModel(sid)
      const finalTodo = props.api.usage.readSessionTodo(sid)
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

  // ── history scan（mount/switch、重试与消息驱动 rescan 共用）──

  /** 将子会话已 idle 的 running 条目标记为已落定。
   *  纯 map 变换——是否持久化由调用方决定。 */
  const settleIdleEntries = (prev: Map<string, SubEntry>): Map<string, SubEntry> => {
    let changed = false
    const settled: string[] = []
    const next = new Map(prev)
    for (const [id, entry] of next) {
      if ((entry.status !== "running" && entry.status !== "cancel_requested") || !entry.sessionId) continue
      try {
        const st = props.api.session.status(entry.sessionId)
        if (!st || st.type !== "idle") continue
        const tokens = props.api.usage.readSessionTokens(entry.sessionId)
        const cost = props.api.usage.readSessionCost(entry.sessionId)
        const finalStatus: SubStatus = entry.status === "cancel_requested" && entry.abortAccepted
          ? "cancelled"
          : "done"
        next.set(id, {
          ...entry, status: finalStatus, endedAt: Date.now(),
          tokens: tokens ?? entry.tokens,
          cost: cost ?? entry.cost,
        })
        changed = true
        settled.push(id)
      } catch {}
    }
    return changed ? next : prev
  }

  /** 周期性兜底遗漏的 session.idle 事件（僵尸 running 条目）。
   *  由 500ms 定时器驱动，即使没有事件到达也能让条目落定。 */
  const reconcileIdleEntries = () => {
    try {
      const before = entryMap()
      const after = settleIdleEntries(before)
      if (after !== before) setEntryMap(after)
    } catch {}
  }

  /** 扫描会话历史并 merge 进 entry map。
   *  消息数据尚不可用时返回 false，供调用方重试。 */
  const runSessionScan = (sid: string, replace: boolean): boolean => {
    let msgs: unknown[] | undefined
    try { msgs = props.api.session.messages(sid) } catch {}
    if (!msgs || (msgs as any[]).length === 0) return false
    // scan 结果先写入内存（setEntryMapRaw）；scan 末尾统一走 persistEntries 的 merge-safe 落盘。
    setEntryMapRaw((prev) => {
      // 优先从模块级缓存加载，KV 仅作缓存未命中时的回退
      const next = replace
        ? new Map(globalEntryCache.get(sid) ?? loadEntries(sid))
        : new Map(prev)
      // 从 KV 加载当前会话的清除名单，扫描时跳过被手动清除的历史条目
      const { parentSid: scanPSid, isChild: scanChild } = resolveParent(sid)
      const scanRec = loadSessionData()[scanPSid]
      const clearedIds = new Set(scanChild ? scanRec?.children?.[sid]?.clearedIds : scanRec?.clearedIds)
      try {
        for (const msg of msgs as any[]) {
          const parts = props.api.session.part((msg as any).id) ?? []
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
              const scanInput = st?.input as Record<string, unknown> | undefined
              // TUI 数据层把子代理 metadata 放在 part 级；旧缓存
              // 形状可能嵌在 state 里。两处都读。
              const scanMeta = partMetadata(part, st)
              const scanSubSid = scanMeta?.session_id !== undefined ? String(scanMeta.session_id)
                : scanMeta?.sessionId !== undefined ? String(scanMeta.sessionId)
                : scanMeta?.sessionID !== undefined ? String(scanMeta.sessionID)
                : undefined
              const existingKey = findSubEntryKey(next, id, scanSubSid)
              const exists = existingKey ? next.get(existingKey) : undefined

              // 已手动清除的条目：scan 发现但不在内存 → 跳过重建
              if (!exists && clearedIds.has(id)) continue

              // Only create entries for tool calls that entered execution.
              // "pending" / empty: skip new entries; allow heuristics for existing ones below.
              if ((rawStatus === "pending" || rawStatus === "") && !exists) continue

              // "error": only update existing, never create a new entry
              if (rawStatus === "error") {
                if (exists && exists.status === "running") {
                  next.set(existingKey ?? id, { ...exists, status: "error", endedAt: Date.now() })
                }
                continue
              }

              // 已落定的条目：仅在补全缺失数据时回访
              // （session/tokens/cost/model）。其终态必须保持。
              const settled =
                exists !== undefined &&
                exists.status !== "running" &&
                exists.status !== "cancel_requested"
              const needsRepair =
                settled &&
                (exists!.sessionId === undefined ||
                  exists!.tokens === undefined ||
                  exists!.cost === undefined ||
                  exists!.model === undefined)
              if (settled && !needsRepair) continue

              let status: SubStatus = "running"
              if (rawStatus === "completed") status = "done"
              // Background tasks: tool completion ≠ agent completion — keep running until session.idle
              // 仅在 metadata 确认已派生子会话时保持 running。
              if ((scanInput?.run_in_background === true || scanInput?.background === true) && status === "done") {
                if (scanSubSid !== undefined) status = "running"
              }
              // 子会话存活判定：工具调用已完成但子会话仍 busy，
              // 说明子代理本身仍在运行（覆盖缓存 part 中
              // 缺少 background 标志的 input）。
              if (status === "done" && scanSubSid) {
                try {
                  const childStatus = props.api.session.status(scanSubSid)
                  if (childStatus && childStatus.type !== "idle") status = "running"
                } catch {}
              }

              if (settled) {
                // 修复流程：保留已记录的终态。
                status = exists!.status
              } else if (exists && status === "running") {
                // Running entry with no explicit status improvement from part:
                // try message-level heuristics first, then time-based fallback.
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

              const agent = String((part as any).subagent_type ?? scanInput?.agent ?? scanInput?.subagent_type ?? tool)
              const prompt = String(scanInput?.prompt ?? (part as any).description ?? "")
              const desc = scanInput?.description !== undefined ? String(scanInput.description) : ""
              const title = desc || truncate(prompt.replace(/\n/g, " ").trim(), 40)

              let tokens: number | undefined
              if (scanSubSid) tokens = props.api.usage.readSessionTokens(scanSubSid)
              let cost: number | undefined
              if (scanSubSid) cost = props.api.usage.readSessionCost(scanSubSid)
              let model: string | undefined
              if (scanSubSid) model = props.api.usage.readSessionModel(scanSubSid)

              const entryKey = existingKey ?? id
              next.set(entryKey, {
                ...(exists ?? { id }),
                title: title || exists?.title || "",
                agent: exists?.agent ?? agent,
                prompt: prompt || exists?.prompt || "",
                // Preserve existing values (from handleSessionEnd / KV) — scan must not overwrite
                tokens: exists?.tokens ?? tokens,
                cost: exists?.cost ?? cost,
                model: exists?.model ?? model,
                sessionId: exists?.sessionId ?? scanSubSid,
                status,
                startedAt: exists?.startedAt || Date.now(),
                endedAt: exists?.endedAt ?? (status === "done" ? Date.now() : undefined),
              })
              if (entryKey !== id) next.delete(id)
            }
          }
        }
      } catch {}
      return next
    })
    // Reconcile: check running entries against live child session status.
    // Covers session.idle events missed while user was inside a child session.
    setEntryMapRaw((prev) => settleIdleEntries(prev))
    // 持久化 scan 修复结果（merge-safe：缺失字段始终以 KV 现有值为准），
    // 让恢复的条目在重新挂载后仍在，并能同步到其他实例。
    const snapshot = entryMap()
    if (snapshot.size > 0) {
      globalEntryCache.set(sid, new Map(snapshot))
      persistEntries(sid, snapshot)
    }
    return true
  }

  let rescanTimer: ReturnType<typeof setTimeout> | undefined

  /** 当最新消息与 entry map 不一致时为 true：子代理 tool part 尚未建条目，
   *  或非后台 tool 已完成而条目仍停在 running。
   *  事件驱动 rescan 与周期性 discovery poll 共用的轻量检查：
   *  即使宿主的所有事件订阅都静默失效，
   *  也能恢复条目。 */
  const missingNewestToolPart = (): boolean => {
    try {
      const msgs = props.api.session.messages(props.sessionId) as any[] | undefined
      if (!msgs || msgs.length === 0) return false
      const map = entryMap()
      const from = Math.max(0, msgs.length - 6)
      for (let i = msgs.length - 1; i >= from; i--) {
        const parts = props.api.session.part(msgs[i]?.id) ?? []
        for (const part of parts as any[]) {
          if (!part || part.type !== "tool") continue
          if (!SUBAGENT_TOOLS.has(String(part.tool ?? ""))) continue
          const partId = String(part.id ?? "")
          if (!partId) continue
          const st = part.state as Record<string, unknown> | undefined
          const rawStatus = String(st?.status ?? "")
          // scan 从不为 pending/error part 创建条目；
          // 这里忽略它们可避免对一直保持该状态的 part 反复 rescan。
          if (rawStatus !== "running" && rawStatus !== "completed") continue
          const id = `tool:${partId}`
          const meta = partMetadata(part, st)
          const subSid = meta?.session_id !== undefined ? String(meta.session_id)
            : meta?.sessionId !== undefined ? String(meta.sessionId)
            : undefined
          const key = findSubEntryKey(map, id, subSid)
          const entry = key ? map.get(key) : undefined
          if (!entry) return true
          // 非后台 tool 已完成、条目却仍停在 running：补一次 scan 收尾
          // （success 事件可能因缺少 metadata 被适配层丢弃）。
          const input = st?.input as Record<string, unknown> | undefined
          const isBackground = input?.background === true || input?.run_in_background === true
          const stillRunning = entry.status === "running" || entry.status === "cancel_requested"
          if (rawStatus === "completed" && !isBackground && stillRunning) return true
        }
      }
    } catch {}
    return false
  }

  /** 新消息到达时防抖重扫。覆盖 scan 早于宿主消息缓存
   *  加载完成的竞态。 */
  const scheduleRescan = () => {
    if (disposed) return
    clearTimeout(rescanTimer)
    rescanTimer = setTimeout(() => {
      if (disposed) return
      untrack(() => {
        if (!missingNewestToolPart()) return
        runSessionScan(props.sessionId, false)
        bump()
      })
    }, 400)
  }

  // usage enrichment 轮询的 round-robin 游标。
  let enrichCursor = 0

  onMount(() => {
    // Fast clock for smooth time display, separate from token polling
    const clock = setInterval(() => { setNow(Date.now()); bump() }, 100)
    // Token poll — runs every 500ms for running entries
    let tick = 0
    const tokenTimer = setInterval(() => {
      tick++
      untrack(() => {
        let enriched: Map<string, SubEntry> | undefined
        let attempted = 0
        setEntryMapRaw((prev) => {
          let changed = false
          const next = new Map(prev)
          // 候选：仍缺 usage 数据的条目。以 round-robin 遍历，
          // 避免一串读不到数据的会话（如 free-model 子会话）
          // 饿死列表其余部分；每个 tick 只读取少数会话。
          const candidates: string[] = []
          for (const [id, entry] of next) {
            if (!entry.sessionId) continue
            const running = entry.status === "running" || entry.status === "cancel_requested"
            const missing = entry.tokens === undefined || entry.cost === undefined || entry.model === undefined
            if (!running && !missing) continue
            candidates.push(id)
          }
          if (candidates.length > 0) {
            const start = enrichCursor % candidates.length
            let budget = 4
            for (let k = 0; k < candidates.length && budget > 0; k++) {
              const id = candidates[(start + k) % candidates.length]
              const entry = next.get(id)
              if (!entry || !entry.sessionId) continue
              // 只从子会话读取，绝不读父会话。较旧的子会话
              // 可能不在本地缓存中，此时它们仍属于
              // 本面板的 map，读取是安全的。
              let isChild = false
              try {
                const s = props.api.session.get(entry.sessionId)
                isChild = !s || s.parentID === props.sessionId
              } catch { isChild = true }
              if (!isChild) continue
              budget--
              attempted++
              const running = entry.status === "running" || entry.status === "cancel_requested"
              let entryChanged = false
              const nextEntry: SubEntry = { ...entry }
              if (running || entry.tokens === undefined) {
                const total = props.api.usage.readSessionTokens(entry.sessionId)
                if (total !== undefined && total !== entry.tokens) { nextEntry.tokens = total; entryChanged = true }
              }
              if (running || entry.cost === undefined) {
                const cost = props.api.usage.readSessionCost(entry.sessionId)
                if (cost !== undefined && cost !== entry.cost) { nextEntry.cost = cost; entryChanged = true }
              }
              if (running || entry.model === undefined) {
                const model = props.api.usage.readSessionModel(entry.sessionId)
                if (model && model !== entry.model) { nextEntry.model = model; entryChanged = true }
              }
              if (running) {
                const todo = props.api.usage.readSessionTodo(entry.sessionId)
                if (todo !== undefined && (todo.total !== entry.todoTotal || todo.done !== entry.todoDone)) {
                  nextEntry.todoTotal = todo.total; nextEntry.todoDone = todo.done; entryChanged = true
                }
              }
              if (entryChanged) { next.set(id, nextEntry); changed = true }
            }
            enrichCursor = (start + Math.max(1, attempted)) % candidates.length
          }
          if (!changed) return prev
          enriched = next
          return next
        })
        if (enriched) {
          // usage enrichment 是真实状态变更（cost/tokens/model）——通过与事件
          // 处理器相同的 merge-safe 路径持久化。
          globalEntryCache.set(props.sessionId, new Map(enriched))
          persistEntries(props.sessionId, enriched)
        }
      })
      reconcileIdleEntries()
      // discovery poll（约每 2s）：恢复从未通过宿主事件到达的
      // 子代理 part。与事件订阅的健康状况无关。
      if (tick % 4 === 0) {
        untrack(() => {
          if (missingNewestToolPart()) {
            runSessionScan(props.sessionId, false)
            bump()
          }
        })
      }
      bump()
    }, 500)
    bump()

    const unsubPart = props.api.event.on("part.updated", (e) => {
      handlePartUpdated(e)
      bump()
    })
    const unsubMsg = props.api.event.on("message.updated", () => { bump(); scheduleRescan() })
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
      clearTimeout(rescanTimer)
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
  let lastTick = 0
  createEffect(() => {
    const sid = props.sessionId
    const switched = sid !== lastSid
    lastSid = sid
    const tick = clearTick()    // 外部触发清除时 +1，effect 重跑
    const forceReload = tick !== lastTick && !switched
    lastTick = tick

    let attempts = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const run = () => {
      untrack(() => {
        if (switched) {
          const { parentSid, isChild } = resolveParent(sid)
          const data = loadSessionData()
          const saved = isChild
            ? data[parentSid]?.children?.[sid]?.scroll ?? 0
            : data[sid]?.scroll ?? 0
          setScrollOffset(saved)
          // 刷新父会话的访问时间 TTL，防止活跃会话的数据过期
          if (!isChild && data[sid]?.entries?.length) {
            void Promise.resolve(updateSessionData(props.api.kv, (latest) => {
              if (latest[sid]?.entries?.length) latest[sid].ts = Date.now()
            })).catch(() => {})
          }
        }
        const ok = runSessionScan(sid, switched || forceReload)
        // 首次挂载时宿主消息缓存可能尚未就绪；
        // 重试几次，避免面板一直空着直到
        // 下一次切换会话。
        if (!ok && attempts < 4) {
          attempts++
          retryTimer = setTimeout(run, 400)
        }
      })
      bump()
    }

    const t = setTimeout(run, 150)
    onCleanup(() => {
      clearTimeout(t)
      if (retryTimer) clearTimeout(retryTimer)
    })
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

  const doneCount = createMemo(() => entryList().filter((e) => e.status === "done" || e.status === "cancelled").length)
  const runningCount = createMemo(() => entryList().filter((e) => e.status === "running" || e.status === "cancel_requested").length)
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

  /** Horizontal space eaten by the panel border (1+1) and its padding (2+2). */
  const gutter = createMemo(() => (props.borderVisible() ? 6 : 0))

  const sep = () => "\u2500".repeat(Math.max(1, panelWidth() - gutter()))

  // The border toggling shifts the box dimensions, which may not reliably
  // re-fire onSizeChange across (re)mount cycles; re-sync panelWidth with the
  // live box so the content width stays correct.
  createEffect(() => {
    props.borderVisible()
    if (boxEl && typeof boxEl.width === "number" && boxEl.width > 0) {
      const w = Math.max(20, boxEl.width)
      setPanelWidth((prev) => (prev === w ? prev : w))
    }
  })

  // ── expanded detail right-align ──
  const expandedMaxLabelW = createMemo(() => {
    const labels = [
      t("agent.label"), t("status.label"), t("time.label"), t("tokens.label"),
      t("error.label"), t("cost.label"), t("model.label"), t("todo.label"), t("session.label"),
    ]
    return Math.max(...labels.map(l => visualWidth(l + ": ")))
  })

  const expandedPad = (label: string) => Math.max(0, expandedMaxLabelW() - visualWidth(label + ": "))

  const expandedValAvail = () => Math.max(6, panelWidth() - gutter() - INDENT - expandedMaxLabelW())

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
    return need <= panelWidth() - gutter()
  })

  const leftCols = createMemo(() => {
    const icon = open() ? "\u25bc" : "\u25b6"
    let w = visualWidth(icon) + 1 + visualWidth(t("panel.title"))
    if (showVersion()) w += versionW
    return w
  })

  const spacerCols = createMemo(() => {
    if (!anyEntry()) return 0
    return Math.max(0, panelWidth() - gutter() - leftCols() - summaryCols())
  })

  const valueCols = (label: string) =>
    Math.max(4, panelWidth() - gutter() - INDENT - visualWidth(label + ": "))

  // ── render ──
  return (
    <box
      border={props.borderVisible()}
      {...(props.borderVisible() ? { borderColor: pal().border } : {})}
      paddingTop={0} paddingBottom={0}
      paddingLeft={props.borderVisible() ? 2 : 0} paddingRight={props.borderVisible() ? 2 : 0}
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
              const isCancelRequested = entry.status === "cancel_requested"
              const isCancelled = entry.status === "cancelled"
              const isError = entry.status === "error"
              const isActiveRunning = isRunning || isCancelRequested
              const elapsed = () => (entry.endedAt ?? now()) - entry.startedAt

              const statusDot = () => "\u25cf"
              const statusColor = () => {
                if (isCancelled) return pal().muted
                if (!isActiveRunning) return isError ? pal().error : pal().success
                const t = (Math.sin(((now() % 2000) / 2000) * Math.PI * 2 - Math.PI / 2) + 1) / 2
                const a = rgb(pal().muted), b = rgb(pal().warning)
                if (!a || !b) return pal().warning
                const r = Math.round(a.r + (b.r - a.r) * t)
                const g = Math.round(a.g + (b.g - a.g) * t)
                const bl = Math.round(a.b + (b.b - a.b) * t)
                return "#" + [r, g, bl].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
              }

              const timeColor = () =>
                isActiveRunning ? pal().warning : isError ? pal().error : pal().muted

              // Entry label: collapsed shows title only, expanded shows title only too
              const tokenText = () =>
                !isExpanded() && props.showEntryTokens() && entry.tokens !== undefined && entry.tokens > 0
                  ? ` ${fmtTokens(entry.tokens!)}`
                  : ""
              const costText = () =>
                !isExpanded() && props.showEntryCost() && entry.cost !== undefined && entry.cost > 0
                  ? ` $${entry.cost.toFixed(4)}`
                  : ""
              const timeText = () =>
                !isExpanded() && props.showEntryTime() && (elapsed() >= 2000 || entry.endedAt !== undefined)
                  ? fmtDuration(elapsed(), isActiveRunning, props.timeFormat())
                  : ""
              const suffixW = () => {
                let w = 0
                const t = timeText()
                if (t) w += 1 + visualWidth(t)
                const tk = tokenText()
                if (tk) w += visualWidth(tk)
                const c = costText()
                if (c) w += visualWidth(c)
                return w
              }
              const labelAvail = () => Math.max(6, panelWidth() - gutter() - LEFT_PAD - suffixW())
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
                    {costText() ? (
                      <span style={{ fg: pal().warning }}>{costText()}</span>
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
                      <span style={{ fg: isActiveRunning ? pal().warning : isCancelled ? pal().muted : isError ? pal().error : pal().success }}>
                        {isActiveRunning ? t("status.running") : isCancelled ? t("status.cancelled") : isError ? t("status.error") : t("status.done")}
                      </span>
                    </text>
                    <Show when={elapsed() >= 2000 || entry.endedAt !== undefined}>
                      <text>
                        {"  "}
                        <span style={{ fg: pal().primary }}>{t("time.label")}: </span>
                        <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("time.label")))}</span>
                        <span style={{ fg: pal().muted }}>
                          {fmtDuration(elapsed(), isActiveRunning, props.timeFormat())}
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
                      {(() => {
                        const cost = entry.cost!
                        return (
                          <text>
                            {"  "}
                            <span style={{ fg: pal().primary }}>{t("cost.label")}: </span>
                            <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("cost.label")))}</span>
                            <span style={{ fg: pal().muted }}>${cost.toFixed(4)}</span>
                          </text>
                        )
                      })()}
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
                        onMouseUp={async () => {
                          const sessionId = entry.sessionId
                          if (!sessionId) return

                          const result = await copyText(sessionId)

                          if (result.copied) {
                            props.api.ui.toast(t("session.toast.copied"), {
                              variant: "success",
                              title: entry.title || entry.agent,
                              duration: 2500,
                            })
                            return
                          }

                          props.api.ui.toast(`${sessionId}\n\n${t("session.toast.copy_failed")}`, {
                            variant: "warning",
                            title: entry.title || entry.agent,
                            duration: 8000,
                          })
                        }}
                      >
                        {"  "}
                        <span style={{ fg: pal().primary }}>{t("session.label")}: </span>
                        <span style={{ fg: pal().muted }}>{" ".repeat(expandedPad(t("session.label")))}</span>
                        <span style={{ fg: pal().muted }}>{truncate(entry.sessionId!, expandedValAvail() - visualWidth(" ⎘"))}</span>
                        <span style={{ fg: pal().warning }}> ⎘</span>
                      </text>
                    </Show>
                    {/* 进入会话 + 取消任务 + 仅清除显示：同排左右两端 */}
                    <Show when={entry.sessionId || isRunning}>
                      {(() => {
                        const openPrefix = () => "  \u2192 "
                        const openFull = () => entry.sessionId ? openPrefix() + t("open.label") : ""
                        const openW = () => entry.sessionId ? visualWidth(openFull()) : 0
                        const cancelLabel = () => ` ${t("cancel.label")}`
                        const dismissLabel = () => ` ${t("dismiss.label")}`
                        const rightW = (isRunning ? visualWidth(dismissLabel()) : 0) + (isRunning && entry.sessionId ? visualWidth(cancelLabel()) : 0)
                        const spacerW = () => Math.max(1, panelWidth() - gutter() - openW() - rightW - 2)
                        return (
                          <box flexDirection="row">
                            <Show when={entry.sessionId}>
                              <text
                                onMouseOver={() => setHoveredOpen(entry.id)}
                                onMouseOut={() => setHoveredOpen(undefined)}
                                onMouseUp={() => {
                                  if (entry.sessionId) {
                                    props.api.route.navigateSession(entry.sessionId)
                                  }
                                }}
                              >
                                <span style={{ fg: hoveredOpen() === entry.id ? pal().warning : pal().primary }}>{openPrefix()}</span>
                                <span style={{ fg: hoveredOpen() === entry.id ? pal().warning : pal().primary }}>{t("open.label")}</span>
                              </text>
                            </Show>
                            <text style={{ fg: pal().muted }}>{" ".repeat(spacerW())}</text>
                            <Show when={isRunning && entry.sessionId}>
                              <text
                                onMouseOver={() => setHoveredCancel(entry.id)}
                                onMouseOut={() => setHoveredCancel(undefined)}
                                onMouseUp={() => cancelEntry(entry)}
                              >
                                <span style={{ fg: hoveredCancel() === entry.id ? pal().warning : pal().error }}>{cancelLabel()}</span>
                              </text>
                            </Show>
                            <Show when={isRunning}>
                              <text
                                onMouseOver={() => setHoveredDismiss(entry.id)}
                                onMouseOut={() => setHoveredDismiss(undefined)}
                                onMouseUp={() => {
                                  upsertEntry({ id: entry.id, title: entry.title, agent: entry.agent, prompt: entry.prompt, status: "done" })
                                }}
                              >
                                <span style={{ fg: hoveredDismiss() === entry.id ? pal().warning : pal().muted }}>{dismissLabel()}</span>
                              </text>
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
                const pad = showTop ? Math.max(1, panelWidth() - gutter() - visualWidth(left) - visualWidth(right)) : 0
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
