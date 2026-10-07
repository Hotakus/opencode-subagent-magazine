import type { PanelEvent, SessionLike } from "./panel-api"

/** V1 events are scoped by the host; V2 events must identify the viewed session. */
export function isCurrentSessionEvent(currentSessionId: string, event: PanelEvent): boolean {
  return event.scope !== "global" || event.payload?.sessionID === currentSessionId
}

/** Whether an end event belongs to a child tracked by the current panel. */
export function isDirectChildSession(
  currentSessionId: string,
  eventSessionId: string,
  eventSession: SessionLike | undefined,
): boolean {
  return eventSessionId !== currentSessionId && eventSession?.parentID === currentSessionId
}
