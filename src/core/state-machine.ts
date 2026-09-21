import type { SubEntry, SubStatus } from "./types"
import type { TodoStats } from "./usage"

/** Final status decision when a child session settles (V1 `session.idle` semantics). */
export function settleOnIdle(entry: SubEntry): SubStatus {
  if (entry.status === "cancel_requested" && entry.abortAccepted) return "cancelled"
  return "done"
}

/** Agent-name normalization used by the fallback matching chain. */
export function normalizeAgent(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, "")
}

/** Snapshot of usage values captured when a child session settles. */
export interface SettleSnapshot {
  tokens?: number
  cost?: number
  model?: string
  todo?: TodoStats
}

/** Apply a settled status + usage backfill onto an entry (no-op preserving already-settled). */
export function settleEntry(
  entry: SubEntry,
  targetStatus: SubStatus,
  nowTs: number,
  snap: SettleSnapshot,
  errorMsg?: string,
): SubEntry {
  const alreadySettled = entry.status !== "running" && entry.status !== "cancel_requested"
  const finalStatus = targetStatus === "error" ? "error" : settleOnIdle(entry)
  return {
    ...entry,
    ...(alreadySettled ? {} : { status: finalStatus, endedAt: nowTs }),
    tokens: entry.tokens ?? snap.tokens,
    cost: entry.cost ?? snap.cost,
    model: entry.model ?? snap.model,
    todoTotal: entry.todoTotal ?? snap.todo?.total,
    todoDone: entry.todoDone ?? snap.todo?.done,
    error: errorMsg || entry.error,
  }
}

/** Time-based scan heuristic: how old must a running entry be before assuming completion. */
export const STALE_RUNNING_MS = 30 * 60 * 1000
