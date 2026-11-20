import type { SessionLike } from "./panel-api"

/** Whether an end event belongs to a child tracked by the current panel. */
export function isDirectChildSession(
  currentSessionId: string,
  eventSessionId: string,
  eventSession: SessionLike | undefined,
  getSession?: (id: string) => SessionLike | undefined,
): boolean {
  if (!currentSessionId || !eventSessionId || eventSessionId === currentSessionId) return false
  if (eventSession?.parentID === currentSessionId) return true
  if (!getSession) return false
  const visited = new Set<string>([eventSessionId])
  let p = eventSession?.parentID ?? getSession(eventSessionId)?.parentID
  while (p && !visited.has(p)) {
    if (p === currentSessionId) return true
    visited.add(p)
    p = getSession(p)?.parentID
  }
  return false
}

export function resolveRootSessionId(
  sid: string,
  getSession?: (id: string) => SessionLike | undefined,
): { rootSid: string; isChild: boolean; ancestorIds: string[] } {
  const visited = new Set<string>([sid])
  const ancestorIds: string[] = []
  let p = getSession?.(sid)?.parentID
  while (p && !visited.has(p)) {
    visited.add(p)
    ancestorIds.push(p)
    p = getSession?.(p)?.parentID
  }
  return { rootSid: ancestorIds[ancestorIds.length - 1] ?? sid, isChild: ancestorIds.length > 0, ancestorIds }
}

export function walkSessionTree(
  rootSid: string,
  visit: (sid: string) => readonly (string | undefined)[],
): string[] {
  const order = [rootSid]
  const seen = new Set<string>(order)
  for (let i = 0; i < order.length; i++) {
    for (const next of visit(order[i])) {
      if (next && !seen.has(next)) {
        seen.add(next)
        order.push(next)
      }
    }
  }
  return order
}
