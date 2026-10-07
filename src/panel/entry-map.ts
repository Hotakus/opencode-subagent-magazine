import type { SubEntry, SubStatus } from "../core/types"

export type SubEntryPatch = Omit<SubEntry, "startedAt" | "endedAt"> & {
  startedAt?: number
  endedAt?: number
}

export function findSubEntryKey(
  entries: ReadonlyMap<string, SubEntry>,
  id: string,
  sessionId?: string,
) {
  if (sessionId) {
    for (const [key, entry] of entries) {
      if (entry.sessionId === sessionId) return key
    }
  }
  return entries.has(id) ? id : undefined
}

export function upsertSubEntry(
  entries: ReadonlyMap<string, SubEntry>,
  partial: SubEntryPatch,
  now = Date.now(),
) {
  const key = findSubEntryKey(entries, partial.id, partial.sessionId) ?? partial.id
  const existing = entries.get(key)
  const next = new Map(entries)
  if (key !== partial.id) next.delete(partial.id)

  const ended = partial.status === "done" || partial.status === "error" || partial.status === "cancelled"
  next.set(key, {
    ...(existing ?? { startedAt: now }),
    ...partial,
    id: existing?.id ?? partial.id,
    startedAt: existing?.startedAt || partial.startedAt || now,
    endedAt: ended ? (existing?.endedAt ?? partial.endedAt ?? now) : undefined,
  })
  return next
}

/** running < cancel_requested < 终态（done/error/cancelled）。 */
function statusRank(status: SubStatus): number {
  if (status === "running") return 0
  if (status === "cancel_requested") return 1
  return 2
}

const isTerminalStatus = (status: SubStatus) => statusRank(status) === 2

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

/**
 * 合并同一子代理条目的两个视图，绝不回退状态。
 *
 * 持久化存储由多个 TUI 实例写入，每个写入者都可能
 * 持有过期快照。终态始终优先于 running /
 * cancel_requested，进度计数只增不减，描述性字段
 * 则回退到仍保有它的一侧。
 */
export function mergeSubEntry(base: SubEntry, incoming: SubEntry): SubEntry {
  const successor = statusRank(incoming.status) > statusRank(base.status) ? incoming : base
  const status = successor.status
  const ended = isTerminalStatus(status)
  return {
    ...base,
    ...incoming,
    id: base.id,
    status,
    sessionId: incoming.sessionId ?? base.sessionId,
    startedAt: minDefined(base.startedAt, incoming.startedAt) ?? base.startedAt,
    endedAt: ended ? (base.endedAt ?? incoming.endedAt ?? Date.now()) : undefined,
    tokens: maxDefined(base.tokens, incoming.tokens),
    cost: maxDefined(base.cost, incoming.cost),
    model: incoming.model ?? base.model,
    todoTotal: maxDefined(base.todoTotal, incoming.todoTotal),
    todoDone: maxDefined(base.todoDone, incoming.todoDone),
    error: incoming.error ?? base.error,
    cancelRequestedAt: minDefined(base.cancelRequestedAt, incoming.cancelRequestedAt),
    abortAccepted: base.abortAccepted || incoming.abortAccepted || undefined,
    cancelReason: incoming.cancelReason ?? base.cancelReason,
  }
}

/**
 * 合并两个条目集合，去重方式与 `upsertSubEntry` 相同
 * （先子会话、后条目 id），冲突用 `mergeSubEntry` 合并。
 * 所有持久化路径都走这里，避免并发实例以整表写入
 * 互相丢弃对方的条目。
 */
export function mergeSubEntries(
  base: Iterable<SubEntry>,
  incoming: Iterable<SubEntry>,
): Map<string, SubEntry> {
  const out = new Map<string, SubEntry>()
  for (const entry of base) out.set(entry.id, entry)
  for (const entry of incoming) {
    const key = findSubEntryKey(out, entry.id, entry.sessionId)
    if (!key) {
      out.set(entry.id, entry)
      continue
    }
    out.set(key, mergeSubEntry(out.get(key)!, entry))
  }
  return out
}

/** 持久化保留的 prompt 前缀长度。prompt 只用于生成 title，不参与渲染；
 *  写入前截断，避免单条 10KB+ 的提示词把 KV 撑大（实测存量 prompt 占 2.9MB/4.4MB）。 */
export const PERSISTED_PROMPT_MAX = 128

/** 压缩条目载荷（当前仅截断 prompt）。已达标时原样返回，避免无谓复制。 */
export function compactSubEntry(entry: SubEntry): SubEntry {
  const prompt = entry.prompt ?? ""
  if (prompt.length <= PERSISTED_PROMPT_MAX) return entry
  return { ...entry, prompt: prompt.slice(0, PERSISTED_PROMPT_MAX) }
}

/** A child can be discovered as tool:<call>, sub:<session>, or another call alias. */
export function isSubEntryCleared(
  entry: Pick<SubEntry, "id" | "sessionId">,
  clearedIds: ReadonlySet<string> | undefined,
): boolean {
  return Boolean(clearedIds?.has(entry.id) ||
    (entry.sessionId && clearedIds?.has(`sub:${entry.sessionId}`)))
}

/**
 * 持久化合并——所有 KV 写入路径的唯一入口：
 * 1. 剔除 id 或子会话已进入 `clearedIds` 的条目（手动清除名单是持久化层权威，
 *    过期快照/debounce 写入都不得把它们合并回去）；
 * 2. 压缩载荷（prompt 截断），base 里的存量胖数据也顺带清理。
 */
export function mergeSubEntriesForPersist(
  base: Iterable<SubEntry>,
  incoming: Iterable<SubEntry>,
  clearedIds: readonly string[] | undefined,
): Map<string, SubEntry> {
  const cleared = new Set(clearedIds ?? [])
  const keep = (entry: SubEntry) => !isSubEntryCleared(entry, cleared)
  return mergeSubEntries(
    [...base].filter(keep).map(compactSubEntry),
    [...incoming].filter(keep).map(compactSubEntry),
  )
}

/**
 * 从清除名单中筛出可安全移除的 id——它们不会再被扫描/轮询重建：
 * - `tool:`：对应 part 已确认状态为 error（扫描从不为 error part 建条目）；
 * `sub:` 现在也是子会话身份 tombstone，历史 tool part 仍可引用已删除的
 * 子会话；即使数据库列表里没有它也不能移除，否则别名会被扫描重建。
 */
export function prunableClearedIds(input: {
  clearedIds: Iterable<string>
  errorToolIds?: ReadonlySet<string>
  liveChildIds?: ReadonlySet<string>
}): string[] {
  const out: string[] = []
  for (const id of input.clearedIds) {
    if (id.startsWith("tool:")) {
      if (input.errorToolIds?.has(id)) out.push(id)
    }
  }
  return out
}

/**
 * 从条目集合中移除 id 或子会话已清除的条目（保留原有 Map 键）。
 * 扫描入口调用：防止 `globalEntryCache` / KV 中残留的已清除
 * 条目在 replace=false 的合并扫描中继续存活。
 */
export function withoutClearedEntries(
  entries: ReadonlyMap<string, SubEntry>,
  clearedIds: ReadonlySet<string> | undefined,
): Map<string, SubEntry> {
  const next = new Map(entries)
  if (!clearedIds || clearedIds.size === 0) return next
  for (const [key, entry] of next) {
    if (isSubEntryCleared(entry, clearedIds)) next.delete(key)
  }
  return next
}
