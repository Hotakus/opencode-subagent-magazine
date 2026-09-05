import type { SessionLike } from "./panel-api"

/** Whether an end event belongs to a child tracked by the current panel. */
export function isDirectChildSession(
  currentSessionId: string,
  eventSessionId: string,
  eventSession: SessionLike | undefined,
): boolean {
  return eventSessionId !== currentSessionId && eventSession?.parentID === currentSessionId
}
