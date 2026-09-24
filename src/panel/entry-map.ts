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
