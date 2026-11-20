/**
 * 本地 opencode.db 只读索引（V2）。
 *
 * 宿主数据层只为当前 TUI 已加载的会话缓存消息：前台子代理（非 background）
 * 的 success 事件经常拿不到 metadata.sessionID，条目会一直停在 running，
 * model/tokens/cost 也无法回填。这些数据在宿主数据库里是完整的：
 * - 父会话 assistant 消息中，工具 part 的 state.metadata.sessionID 指向子会话（前台/后台都有）；
 * - session_v2 保存子会话的 agent/model/tokens/cost 与 time_idle/idle_outcome。
 *
 * 本模块以只读方式查询该库作为补充数据源；bun:sqlite 不可用、库不存在或
 * 设置项 dbSync 关闭时静默禁用（回退宿主 API）。库结构属于宿主内部实现，
 * 任何读取失败都返回 undefined，绝不影响面板其余功能。
 */

import { homedir } from "node:os"

export interface ChildSessionInfo {
  id: string
  parentId?: string
  agent?: string
  title?: string
  model?: string
  cost?: number
  tokens?: number
  totalTokens?: number
  timeCreated?: number
  timeIdle?: number
  idleOutcome?: string
  /** 仍在运行：最后一条消息晚于 time_idle（会话被恢复时 time_idle 不会被清空）。 */
  active?: boolean
}

export interface SessionDbIndex {
  /** 数据库可用且设置项开启时为 true。 */
  enabled(): boolean
  /** call id → child session id, looked up in the tool calls of this session only (foreground and background). */
  resolveCall(parentId: string, callId: string): string | undefined
  /** One statement: which of these call ids were made in these sessions, and the child session each one started. undefined = the read failed. */
  resolveCalls(sessionIds: string[], callIds: string[]): Map<string, string> | undefined
  /** 无 call id 时的兜底：按 agent + 起始时间匹配子会话。directOnly 时只看直接子会话。 */
  matchChild(parentId: string, agent: string | undefined, startedAt: number | undefined, directOnly?: boolean, excludeIds?: ReadonlySet<string>): string | undefined
  /** 子会话汇总（model/tokens/cost/time_idle）。 */
  info(sid: string): ChildSessionInfo | undefined
  /** The row of this session from the last tree read of children(), while that read is at most 15 s old. Never runs a statement. */
  peek(sid: string): ChildSessionInfo | undefined
  /** 该会话派生的子会话（spawn），用于补全没有工具条目的衍生会话。 */
  children(parentId: string): ChildSessionInfo[] | undefined
}

type SqlRow = Record<string, unknown>
interface SqlStatement {
  all(...params: unknown[]): SqlRow[]
  get(...params: unknown[]): SqlRow | undefined
}
export interface SqlDatabase {
  query(sql: string): SqlStatement
  close?(): void
}

// 动态加载：仅 Bun 运行时可用。字符串变量使 tsc/esbuild 不做静态解析，
// 打包产物保留运行时 import；Node（CI 测试）加载失败会静默禁用。
const BUN_SQLITE = "bun:sqlite"

/** 从宿主 model 字段提取模型 id。
 *  兼容三种形态：名字字符串、{ id } 对象，以及序列化后的 JSON 字符串
 *  （session_v2.model 列存的就是 `{"id":...}` 文本）。 */
export function modelIdOf(value: unknown): string | undefined {
  if (typeof value === "string") {
    const s = value.trim()
    if (s.length === 0) return undefined
    if (s.startsWith("{")) {
      try { return modelIdOf(JSON.parse(s)) } catch { return undefined }
    }
    return s
  }
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id
    if (id === undefined) return undefined
    const direct = modelIdOf(id)
    if (direct !== undefined) return direct
    const s = String(id)
    return s.length > 0 ? s : undefined
  }
  return undefined
}

/** 宿主 readSessionTokens 同语义：最后一条 assistant 消息的上下文规模。 */
export function contextTokens(tokens: unknown): number | undefined {
  if (!tokens || typeof tokens !== "object") return undefined
  const t = tokens as Record<string, unknown>
  const cache = (t.cache && typeof t.cache === "object") ? (t.cache as Record<string, unknown>) : {}
  const sum =
    (Number(t.input) || 0) +
    (Number(t.output) || 0) +
    (Number(t.reasoning) || 0) +
    (Number(cache.read) || 0) +
    (Number(cache.write) || 0)
  return sum > 0 ? sum : undefined
}

/** 子会话是否仍在运行。
 *  恢复过的会话会保留旧的 time_idle（host 不清空），因此以
 *  「最后一条消息是否晚于 time_idle」为准；最后一条是 idle
 *  消息则视为已停止。 */
export function isSessionActive(input: {
  timeIdle?: number
  lastMessageType?: string
  lastMessageAt?: number
}): boolean {
  const { timeIdle, lastMessageType, lastMessageAt } = input
  if (lastMessageType === "idle") return false
  if (lastMessageAt === undefined) return false
  if (timeIdle === undefined) return true
  return lastMessageAt > timeIdle
}

/** 子会话终态：time_idle 存在且没有恢复活动才算结束；interrupted 视为取消。
 *  没有 time_idle 时不作判断（交给宿主实时状态）——避免时间阈值猜测。 */
export function statusOfChild(info: ChildSessionInfo | undefined): "done" | "cancelled" | undefined {
  if (!info) return undefined
  if (info.active === true) return undefined
  if (info.timeIdle == null) return undefined
  return info.idleOutcome === "interrupted" ? "cancelled" : "done"
}

/** 定位宿主数据库（可用 OPENCODE_DB 覆盖，遵循 XDG_DATA_HOME）。 */
export function findDbPath(
  env: Record<string, string | undefined> = process.env,
  home = safeHomedir(),
): string | undefined {
  if (env.OPENCODE_DB) return env.OPENCODE_DB
  const base = env.XDG_DATA_HOME && env.XDG_DATA_HOME.length > 0 ? env.XDG_DATA_HOME : `${home}/.local/share`
  if (!base || base === "/.local/share") return undefined
  return `${base}/opencode/opencode.db`
}

function safeHomedir(): string {
  try { return homedir() } catch { return "" }
}

const CALL_MAP_SQL = `
  SELECT json_extract(p.value, '$.id') AS call_id,
         json_extract(p.value, '$.state.metadata.sessionID') AS child_sid
  FROM session_message m, json_each(m.data, '$.content') p
  WHERE m.session_id = ? AND m.type = 'assistant'
    AND json_extract(p.value, '$.id') LIKE 'call_%'
    AND json_extract(p.value, '$.state.metadata.sessionID') IS NOT NULL`

const CHILD_INFO_SQL = `
  SELECT parent_id, agent, title, model, cost,
         tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
         time_created, time_idle, idle_outcome
  FROM session_v2 WHERE id = ?`

const LAST_ASSISTANT_SQL = `
  SELECT json_extract(data, '$.tokens.input') AS input,
         json_extract(data, '$.tokens.output') AS output,
         json_extract(data, '$.tokens.reasoning') AS reasoning,
         json_extract(data, '$.tokens.cache.read') AS cache_read,
         json_extract(data, '$.tokens.cache.write') AS cache_write,
         json_extract(data, '$.model.id') AS model_id
  FROM session_message
  WHERE session_id = ? AND type = 'assistant' AND json_extract(data, '$.tokens.output') > 0
  ORDER BY seq DESC LIMIT 1`

const LAST_MESSAGE_SQL = `
  SELECT type, COALESCE(time_updated, time_created) AS at
  FROM session_message WHERE session_id = ? ORDER BY seq DESC LIMIT 1`

const ASSISTANT_COST_SQL = `
  SELECT COUNT(*) AS n, SUM(COALESCE(json_extract(data, '$.cost'), 0)) AS total
  FROM session_message WHERE session_id = ? AND type = 'assistant'`

// One statement for a whole subtree: the session rows plus what info() reads per session (last message, last assistant usage, summed cost).
// UNION drops rows already seen, so a parent_id cycle ends; forks are not followed.
const TREE_SQL = `
  WITH RECURSIVE tree(id) AS (
    SELECT ? UNION
    SELECT s.id FROM session_v2 s JOIN tree ON s.parent_id = tree.id
    WHERE s.fork_session_id IS NULL OR s.fork_session_id = '')
  SELECT s.id, s.parent_id, s.agent, s.title, s.model, s.cost,
         s.tokens_input, s.tokens_output, s.tokens_reasoning, s.tokens_cache_read, s.tokens_cache_write,
         s.time_created, s.time_idle, s.idle_outcome,
         (SELECT type FROM session_message WHERE session_id = s.id ORDER BY seq DESC LIMIT 1) AS last_type,
         (SELECT COALESCE(time_updated, time_created) FROM session_message WHERE session_id = s.id ORDER BY seq DESC LIMIT 1) AS last_at,
         (SELECT json_object('input', json_extract(data, '$.tokens.input'), 'output', json_extract(data, '$.tokens.output'),
                 'reasoning', json_extract(data, '$.tokens.reasoning'), 'cache_read', json_extract(data, '$.tokens.cache.read'),
                 'cache_write', json_extract(data, '$.tokens.cache.write'), 'model_id', json_extract(data, '$.model.id'))
          FROM session_message WHERE session_id = s.id AND type = 'assistant' AND json_extract(data, '$.tokens.output') > 0
          ORDER BY seq DESC LIMIT 1) AS la,
         CASE WHEN s.cost > 0 THEN NULL ELSE (
           SELECT json_object('n', COUNT(*), 'total', SUM(COALESCE(json_extract(data, '$.cost'), 0)))
           FROM session_message WHERE session_id = s.id AND type = 'assistant') END AS ac
  FROM session_v2 s WHERE s.id IN (SELECT id FROM tree) AND s.id <> ?
  ORDER BY s.time_created, s.id`

// CALL_MAP_SQL for many sessions and many call ids at once (both passed as JSON arrays).
const CALLS_SQL = `
  SELECT json_extract(p.value, '$.id') AS call_id,
         json_extract(p.value, '$.state.metadata.sessionID') AS child_sid
  FROM session_message m, json_each(m.data, '$.content') p
  WHERE m.session_id IN (SELECT value FROM json_each(?)) AND m.type = 'assistant'
    AND json_extract(p.value, '$.id') IN (SELECT value FROM json_each(?))
    AND json_extract(p.value, '$.state.metadata.sessionID') IS NOT NULL`

const num = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

export function createSessionDbIndex(enabled: () => boolean, injectedDb?: SqlDatabase): SessionDbIndex | undefined {
  let db: SqlDatabase | undefined = injectedDb
  let failed = false
  if (!injectedDb) {
    const dbPath = findDbPath()
    if (!dbPath) return undefined
    void (async () => {
      try {
        const mod = (await import(BUN_SQLITE)) as { Database?: new (p: string, o?: Record<string, unknown>) => SqlDatabase }
        const Database = mod?.Database
        if (!Database) { failed = true; return }
        db = new Database(dbPath, { readonly: true })
        try { db.query("pragma query_only = on").all() } catch {}
      } catch {
        failed = true
        db = undefined
      }
    })()
  }

  const CALL_MAP_TTL_MS = 15000
  const CALL_MAP_RETRY_MS = 2000
  const INFO_TTL_MS = 5000
  const callMaps = new Map<string, { map: Map<string, string>; at: number }>()
  const infos = new Map<string, { info: ChildSessionInfo | undefined; at: number }>()
  const childrenCache = new Map<string, { list: SqlRow[]; at: number }>()

  const ready = (): boolean => {
    if (failed || db === undefined) return false
    try { return enabled() } catch { return false }
  }

  // One statement per root per CALL_MAP_TTL_MS. A failed read throws and caches nothing, so callers can tell "unavailable" from "no children".
  const listDescendantRows = (rootId: string): SqlRow[] => {
    const now = Date.now()
    const cached = childrenCache.get(rootId)
    if (cached && now - cached.at <= CALL_MAP_TTL_MS) return cached.list
    const list = db!.query(TREE_SQL).all(rootId, rootId)
    childrenCache.set(rootId, { list, at: now })
    return list
  }

  const buildCallMap = (parentId: string): Map<string, string> => {
    const now = Date.now()
    const prev = callMaps.get(parentId)
    if (prev && now - prev.at < CALL_MAP_RETRY_MS) return prev.map
    const map = new Map<string, string>()
    try {
      for (const row of db!.query(CALL_MAP_SQL).all(parentId)) {
        const id = str(row.call_id)
        const sid = str(row.child_sid)
        if (id && sid) map.set(id, sid)
      }
    } catch {}
    callMaps.set(parentId, { map, at: now })
    return map
  }

  const resolveCalls = (sessionIds: string[], callIds: string[]): Map<string, string> | undefined => {
    if (!ready()) return undefined
    const out = new Map<string, string>()
    if (sessionIds.length === 0 || callIds.length === 0) return out
    try {
      for (const row of db!.query(CALLS_SQL).all(JSON.stringify(sessionIds), JSON.stringify(callIds))) {
        const id = str(row.call_id)
        const sid = str(row.child_sid)
        if (id && sid && !out.has(id)) out.set(id, sid)
      }
    } catch { return undefined }
    return out
  }

  const resolveCall = (parentId: string, callId: string): string | undefined => {
    if (!ready() || !parentId || !callId) return undefined
    const prev = callMaps.get(parentId)
    const map = prev && Date.now() - prev.at < CALL_MAP_TTL_MS ? prev.map : buildCallMap(parentId)
    return map.get(callId) ?? buildCallMap(parentId).get(callId)
  }

  const matchChild = (parentId: string, agent: string | undefined, startedAt: number | undefined, directOnly = false, excludeIds?: ReadonlySet<string>): string | undefined => {
    if (!ready() || !parentId || startedAt === undefined) return undefined
    const cmap = excludeIds ? (callMaps.get(parentId)?.map ?? buildCallMap(parentId)) : undefined, claimed = cmap ? new Set(cmap.values()) : undefined
    let best: string | undefined
    let bestAt = Number.POSITIVE_INFINITY
    for (const row of listDescendantRows(parentId)) {
      const sid = str(row.id)
      const t = num(row.time_created)
      if (!sid || t === undefined || excludeIds?.has(sid) || claimed?.has(sid)) continue
      if (directOnly && str(row.parent_id) !== parentId) continue
      if (t < startedAt - 2000) continue
      if (agent !== undefined && str(row.agent) !== agent) continue
      if (t < bestAt) { bestAt = t; best = sid }
    }
    return best
  }

  const info = (sid: string): ChildSessionInfo | undefined => {
    if (!sid) return undefined
    const hit = infos.get(sid)
    if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit.info
    if (!ready()) return undefined
    let result: ChildSessionInfo | undefined
    try {
      const row = db!.query(CHILD_INFO_SQL).get(sid)
      if (row) {
        const last = db!.query(LAST_ASSISTANT_SQL).get(sid)
        const lastMsg = db!.query(LAST_MESSAGE_SQL).get(sid)
        let tokens = contextTokens(last ? {
          input: last.input, output: last.output, reasoning: last.reasoning,
          cache: { read: last.cache_read, write: last.cache_write },
        } : undefined)
        const agg = (num(row.tokens_input) || 0) + (num(row.tokens_output) || 0) + (num(row.tokens_reasoning) || 0) +
          (num(row.tokens_cache_read) || 0) + (num(row.tokens_cache_write) || 0)
        if (tokens === undefined && agg > 0) tokens = agg
        // cost 语义对齐宿主 readSessionCost：优先会话聚合值，
        // 0 时回退 assistant 消息求和（有消息即权威，0 表示确实免费）。
        let cost = num(row.cost)
        if (!(typeof cost === "number" && cost > 0)) {
          const aggCost = db!.query(ASSISTANT_COST_SQL).get(sid)
          if (aggCost && Number(aggCost.n) > 0) cost = Number(aggCost.total) || 0
        }
        result = {
          id: sid,
          parentId: str(row.parent_id),
          agent: str(row.agent),
          title: str(row.title),
          model: modelIdOf(last?.model_id) ?? modelIdOf(row.model),
          cost,
          tokens,
          totalTokens: agg > 0 ? agg : undefined,
          timeCreated: num(row.time_created),
          timeIdle: num(row.time_idle),
          idleOutcome: str(row.idle_outcome),
          active: isSessionActive({
            timeIdle: num(row.time_idle),
            lastMessageType: str(lastMsg?.type),
            lastMessageAt: num(lastMsg?.at),
          }),
        }
      }
    } catch { result = undefined }
    infos.set(sid, { info: result, at: Date.now() })
    return result
  }

  const treeInfo = new Map<string, { info: ChildSessionInfo; at: number }>()
  const seededAt = new Map<string, number>()
  const peek = (sid: string): ChildSessionInfo | undefined => {
    const hit = treeInfo.get(sid)
    return hit && Date.now() - hit.at <= CALL_MAP_TTL_MS ? hit.info : undefined
  }

  const children = (parentId: string): ChildSessionInfo[] | undefined => {
    if (!ready() || !parentId) return undefined
    const out: ChildSessionInfo[] = []
    for (const row of listDescendantRows(parentId)) {
      const sid = str(row.id)
      if (!sid) continue
      // Same values as info(), read from the columns of the tree row instead of three statements per session.
      const last = typeof row.la === "string" ? (JSON.parse(row.la) as SqlRow) : undefined
      const aggCost = typeof row.ac === "string" ? (JSON.parse(row.ac) as SqlRow) : undefined
      const tokens = contextTokens(last ? {
        input: last.input, output: last.output, reasoning: last.reasoning,
        cache: { read: last.cache_read, write: last.cache_write },
      } : undefined)
      const agg = (num(row.tokens_input) || 0) + (num(row.tokens_output) || 0) + (num(row.tokens_reasoning) || 0) +
        (num(row.tokens_cache_read) || 0) + (num(row.tokens_cache_write) || 0)
      let cost = num(row.cost)
      if (!(typeof cost === "number" && cost > 0) && aggCost && Number(aggCost.n) > 0) cost = Number(aggCost.total) || 0
      out.push({
        id: sid,
        parentId: str(row.parent_id) ?? parentId,
        agent: str(row.agent),
        title: str(row.title),
        model: modelIdOf(last?.model_id) ?? modelIdOf(row.model),
        cost,
        tokens: tokens ?? (agg > 0 ? agg : undefined),
        totalTokens: agg > 0 ? agg : undefined,
        timeCreated: num(row.time_created),
        timeIdle: num(row.time_idle),
        idleOutcome: str(row.idle_outcome),
        active: isSessionActive({
          timeIdle: num(row.time_idle),
          lastMessageType: str(row.last_type),
          lastMessageAt: num(row.last_at),
        }),
      })
    }
    // Once per tree read: keep the rows, stamped with the time of the read, so peek() and info() answer from them without a statement.
    const at = childrenCache.get(parentId)?.at ?? 0
    if (seededAt.get(parentId) !== at) {
      seededAt.set(parentId, at)
      for (const c of out) { treeInfo.set(c.id, { info: c, at }); infos.set(c.id, { info: c, at }) }
    }
    return out
  }

  return { enabled: ready, resolveCall, resolveCalls, matchChild, info, peek, children }
}
