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
  timeCreated?: number
  timeIdle?: number
  idleOutcome?: string
}

export interface SessionDbIndex {
  /** 数据库可用且设置项开启时为 true。 */
  enabled(): boolean
  /** call id → 子会话 id（前台/后台通用）。 */
  resolveCall(parentId: string, callId: string): string | undefined
  /** 无 call id 时的兜底：按 agent + 起始时间匹配子会话。 */
  matchChild(parentId: string, agent: string | undefined, startedAt: number | undefined): string | undefined
  /** 子会话汇总（model/tokens/cost/time_idle）。 */
  info(sid: string): ChildSessionInfo | undefined
}

type SqlRow = Record<string, unknown>
interface SqlStatement {
  all(...params: unknown[]): SqlRow[]
  get(...params: unknown[]): SqlRow | undefined
}
interface SqlDatabase {
  query(sql: string): SqlStatement
  close?(): void
}

// 动态加载：仅 Bun 运行时可用。字符串变量使 tsc/esbuild 不做静态解析，
// 打包产物保留运行时 import；Node（CI 测试）加载失败会静默禁用。
const BUN_SQLITE = "bun:sqlite"

/** 从宿主 model 字段（字符串或 { id } 对象）提取模型 id。 */
export function modelIdOf(value: unknown): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id
    if (id !== undefined) return String(id)
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

/** 子会话终态：time_idle 存在才算结束；interrupted 视为取消。
 *  没有 time_idle 时不作判断（交给宿主实时状态）——避免时间阈值猜测。 */
export function statusOfChild(info: ChildSessionInfo | undefined): "done" | "cancelled" | undefined {
  if (!info || info.timeIdle == null) return undefined
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

const ASSISTANT_COST_SQL = `
  SELECT COUNT(*) AS n, SUM(COALESCE(json_extract(data, '$.cost'), 0)) AS total
  FROM session_message WHERE session_id = ? AND type = 'assistant'`

const CHILDREN_SQL = `
  SELECT id, agent, time_created FROM session_v2 WHERE parent_id = ? ORDER BY time_created`

const num = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

export function createSessionDbIndex(enabled: () => boolean): SessionDbIndex | undefined {
  const dbPath = findDbPath()
  if (!dbPath) return undefined

  let db: SqlDatabase | undefined
  let failed = false
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

  const resolveCall = (parentId: string, callId: string): string | undefined => {
    if (!ready() || !parentId || !callId) return undefined
    const prev = callMaps.get(parentId)
    const map = prev && Date.now() - prev.at < CALL_MAP_TTL_MS ? prev.map : buildCallMap(parentId)
    return map.get(callId) ?? buildCallMap(parentId).get(callId)
  }

  const matchChild = (parentId: string, agent: string | undefined, startedAt: number | undefined): string | undefined => {
    if (!ready() || !parentId || startedAt === undefined) return undefined
    const now = Date.now()
    let cached = childrenCache.get(parentId)
    if (!cached || now - cached.at > CALL_MAP_TTL_MS) {
      let list: SqlRow[] = []
      try { list = db!.query(CHILDREN_SQL).all(parentId) } catch {}
      cached = { list, at: now }
      childrenCache.set(parentId, cached)
    }
    let best: string | undefined
    let bestAt = Number.POSITIVE_INFINITY
    for (const row of cached.list) {
      const sid = str(row.id)
      const t = num(row.time_created)
      if (!sid || t === undefined) continue
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
        let tokens = contextTokens(last ? {
          input: last.input, output: last.output, reasoning: last.reasoning,
          cache: { read: last.cache_read, write: last.cache_write },
        } : undefined)
        if (tokens === undefined) {
          const agg = (num(row.tokens_input) || 0) + (num(row.tokens_output) || 0) + (num(row.tokens_reasoning) || 0) +
            (num(row.tokens_cache_read) || 0) + (num(row.tokens_cache_write) || 0)
          if (agg > 0) tokens = agg
        }
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
          timeCreated: num(row.time_created),
          timeIdle: num(row.time_idle),
          idleOutcome: str(row.idle_outcome),
        }
      }
    } catch { result = undefined }
    infos.set(sid, { info: result, at: Date.now() })
    return result
  }

  return { enabled: ready, resolveCall, matchChild, info }
}
