import type { SubEntry } from "../core/types"

export type SubEntryPatch = Omit<SubEntry, "startedAt" | "endedAt"> & {
  startedAt?: number
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
    endedAt: ended ? (existing?.endedAt || now) : undefined,
  })
  return next
}
