import { isBackgroundInput, SUBAGENT_TOOLS, type SubEntry } from "../core/types"
import { findSubEntryKey, isSubEntryCleared } from "./entry-map"
import type { PanelApi } from "./panel-api"

/** Cheap recovery probe. Cleared parts must not keep triggering full history scans. */
export function hasMissingSubagentPart(
  session: PanelApi["session"],
  sid: string,
  entries: ReadonlyMap<string, SubEntry>,
  clearedIds: ReadonlySet<string>,
): boolean {
  try {
    const messages = session.messages(sid) as Array<{ id: string }> | undefined
    if (!messages?.length) return false
    const from = Math.max(0, messages.length - 6)
    for (let i = messages.length - 1; i >= from; i--) {
      for (const raw of session.part(messages[i]?.id) ?? []) {
        const part = raw as Record<string, any>
        if (!part || part.type !== "tool" || !part.id || !SUBAGENT_TOOLS.has(String(part.tool ?? ""))) continue
        const state = part.state as Record<string, any> | undefined
        if (state?.status !== "running" && state?.status !== "completed") continue
        const id = `tool:${part.id}`
        if (clearedIds.has(id)) continue
        const meta = { ...state?.metadata, ...part.metadata }
        const childID = meta.session_id ?? meta.sessionId ?? meta.sessionID
        let subSid = childID == null ? undefined : String(childID)
        if (!subSid && clearedIds.size > 0) {
          try { subSid = session.resolveChild?.({ parentId: sid, callId: String(part.id) }) } catch {}
        }
        if (isSubEntryCleared({ id, sessionId: subSid }, clearedIds)) continue
        const key = findSubEntryKey(entries, id, subSid)
        const entry = key ? entries.get(key) : undefined
        if (!entry) return true
        const stillRunning = entry.status === "running" || entry.status === "cancel_requested"
        if (state?.status === "completed" && !isBackgroundInput(state.input) && stillRunning) return true
      }
    }
  } catch {}
  return false
}
