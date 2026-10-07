import { updateSessionData } from "../core/kv"
import { SUBAGENT_TOOLS, type SessionRecord, type SubEntry } from "../core/types"
import { isSubEntryCleared } from "./entry-map"
import type { PanelApi } from "./panel-api"

/** Clear one panel, not the actual OpenCode sessions or other panels' history.
 *  Capture all discovery identities, then merge tombstones under the storage lock.
 *  Neither a later scan nor another TUI's delayed snapshot may restore them. */
export async function clearSessionEntries(
  api: Pick<PanelApi, "kv" | "session">,
  sid: string,
  cachedEntries: Iterable<SubEntry>,
): Promise<number> {
  const parentID = api.session.get(sid)?.parentID
  const discovered: Array<Pick<SubEntry, "id" | "sessionId">> = [...cachedEntries]
  try {
    for (const child of api.session.listChildren?.(sid) ?? []) {
      discovered.push({ id: `sub:${child.id}`, sessionId: child.id })
    }
  } catch {}
  try {
    for (const message of api.session.messages(sid) ?? []) {
      const messageID = (message as { id?: string })?.id
      if (!messageID) continue
      for (const raw of api.session.part(messageID) ?? []) {
        const part = raw as Record<string, any>
        if (part.type === "subtask" && part.id) {
          discovered.push({ id: `sub:${part.id}`, sessionId: part.sessionID })
        }
        if (part.type !== "tool" || !part.id || !SUBAGENT_TOOLS.has(String(part.tool ?? ""))) continue
        const metadata = { ...part.state?.metadata, ...part.metadata }
        const childID = metadata.session_id ?? metadata.sessionId ?? metadata.sessionID
        discovered.push({ id: `tool:${part.id}`, sessionId: childID == null ? undefined : String(childID) })
      }
    }
  } catch {}

  let count = 0
  await updateSessionData(api.kv, (data) => {
    const rootID = parentID ?? sid
    const root: SessionRecord = data[rootID] ?? (data[rootID] = {
      ts: Date.now(), entries: [], scroll: 0, expanded: "", children: {},
    })
    root.children ??= {}
    const target = parentID
      ? root.children[sid] ?? (root.children[sid] = { entries: [], scroll: 0, expanded: "" })
      : root
    const previous = new Set(target.clearedIds ?? [])
    const cleared = new Set(previous)
    const identities = new Set<string>()
    for (const entry of [...(target.entries ?? []), ...discovered]) {
      let childID = entry.sessionId
      if (!childID && entry.id.startsWith("tool:")) {
        try { childID = api.session.resolveChild?.({ parentId: sid, callId: entry.id.slice(5) }) } catch {}
      }
      if (!isSubEntryCleared({ id: entry.id, sessionId: childID }, previous)) {
        identities.add(childID ? `sub:${childID}` : entry.id)
      }
      cleared.add(entry.id)
      if (childID) cleared.add(`sub:${childID}`)
    }
    count = identities.size
    target.entries = []
    target.scroll = 0
    target.expanded = ""
    target.clearedIds = [...cleared]
    root.ts = Date.now()
  })
  return count
}
