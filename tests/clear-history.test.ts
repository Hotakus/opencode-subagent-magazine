import assert from "node:assert/strict"
import test from "node:test"
import { SESSION_DATA_KEY, updateSessionData, type KVApi } from "../src/core/kv"
import type { SessionRecord, SubEntry } from "../src/core/types"
import { clearSessionEntries } from "../src/panel/clear-history"
import { mergeSubEntriesForPersist, withoutClearedEntries } from "../src/panel/entry-map"
import type { PanelApi } from "../src/panel/panel-api"

const entry = (id: string, sessionId?: string): SubEntry => ({
  id, sessionId, agent: "explore", title: id, prompt: "", status: "done", startedAt: 10,
})
const record = (entries: SubEntry[] = []): SessionRecord => ({
  ts: 1, entries, scroll: 3, expanded: entries[0]?.id ?? "", children: {},
})
function fixture(initial: Record<string, SessionRecord>, atomic = true) {
  let disk = JSON.stringify(initial)
  let writes = 0
  const kv: KVApi = {
    get: (_key, fallback) => disk ?? fallback,
    set: (key, value) => { assert.equal(key, SESSION_DATA_KEY); disk = String(value); writes++ },
  }
  if (atomic) kv.update = (key, updater) => {
    assert.equal(key, SESSION_DATA_KEY)
    disk = String(updater(disk)); writes++
  }
  const session: PanelApi["session"] = {
    get: (id) => ({ id }), status: () => ({ type: "idle" }),
    messages: () => [], part: () => [],
  }
  return { api: { kv, session }, read: () => JSON.parse(disk) as Record<string, SessionRecord>, writes: () => writes }
}

test("one clear blocks tool, database and stale-cache aliases and all delayed saves", async () => {
  const old = entry("tool:first", "child-1")
  const f = fixture({ root: record([old]) })
  assert.equal(await clearSessionEntries(f.api, "root", [old]), 1)
  const cleared = new Set(f.read().root.clearedIds)
  assert.deepEqual([...cleared].sort(), ["sub:child-1", "tool:first"])
  const aliases = [entry("tool:another-call", "child-1"), entry("sub:child-1", "child-1")]
  assert.equal(withoutClearedEntries(new Map(aliases.map((e) => [e.id, e])), cleared).size, 0)
  for (let i = 0; i < 3; i++) {
    await updateSessionData(f.api.kv, (data) => {
      const rec = data.root
      rec.entries = [...mergeSubEntriesForPersist(rec.entries, [old, ...aliases], rec.clearedIds).values()]
    })
  }
  assert.deepEqual(f.read().root.entries, [])
})

test("clear captures unpersisted cache entries, undiscovered children and every historical tool alias", async () => {
  const f = fixture({ root: record([entry("tool:first", "child-1")]) })
  f.api.session.listChildren = () => [{ id: "child-1" }, { id: "child-2" }, { id: "child-3" }]
  f.api.session.messages = () => [{ id: "message-1" }]
  f.api.session.part = () => [
    { type: "tool", tool: "task", id: "continuation", state: { metadata: { session_id: "child-1" } } },
    { type: "tool", tool: "subagent", id: "pending", state: { status: "pending" }, metadata: { sessionID: "child-3" } },
    { type: "tool", tool: "shell", id: "not-a-subagent" },
  ]
  assert.equal(await clearSessionEntries(f.api, "root", [entry("tool:unpersisted", "child-2")]), 3)
  assert.deepEqual(f.read().root.clearedIds?.sort(), [
    "sub:child-1", "sub:child-2", "sub:child-3", "tool:continuation", "tool:first", "tool:pending", "tool:unpersisted",
  ])
  assert.equal(f.read().root.scroll, 0)
  assert.equal(f.read().root.expanded, "")
})

test("a single clear works with no saved record and subtask history only", async () => {
  const f = fixture({})
  f.api.session.messages = () => [{ id: "m" }]
  f.api.session.part = () => [{ type: "subtask", id: "spawn-part", sessionID: "child-1" }]
  assert.equal(await clearSessionEntries(f.api, "root", []), 1)
  assert.deepEqual(f.read().root.clearedIds, ["sub:spawn-part", "sub:child-1"])
})

test("clearing a child panel leaves its parent's and sibling's records unchanged", async () => {
  const root = record([entry("tool:parent-record", "child-panel")])
  root.children["child-panel"] = { entries: [entry("tool:nested", "nested-child")], scroll: 4, expanded: "nested" }
  root.children.sibling = { entries: [entry("tool:sibling", "other-child")], scroll: 5, expanded: "sibling" }
  const original = structuredClone(root)
  const f = fixture({ root })
  f.api.session.get = (id) => ({ id, parentID: "root" })
  await clearSessionEntries(f.api, "child-panel", [])
  assert.deepEqual(f.read().root.entries, original.entries)
  assert.deepEqual(f.read().root.children.sibling, original.children.sibling)
  assert.deepEqual(f.read().root.children["child-panel"].entries, [])
  assert.deepEqual(f.read().root.children["child-panel"].clearedIds, ["tool:nested", "sub:nested-child"])
})

test("clear resolves missing child links by exact call ID before storing the tombstone", async () => {
  const f = fixture({ root: record([entry("tool:call-1")]) })
  f.api.session.resolveChild = ({ parentId, callId }) => {
    assert.equal(parentId, "root"); assert.equal(callId, "call-1")
    return "child-1"
  }
  await clearSessionEntries(f.api, "root", [])
  assert.deepEqual(f.read().root.clearedIds, ["tool:call-1", "sub:child-1"])
})

test("clear merges the latest locked disk record rather than a stale panel snapshot", async () => {
  const f = fixture({ root: record([entry("tool:other-tui", "child-2")]), unrelated: record([entry("tool:keep", "child-3")]) })
  await clearSessionEntries(f.api, "root", [entry("tool:stale-cache", "child-1")])
  assert.equal(f.writes(), 1)
  assert.deepEqual(f.read().root.clearedIds?.sort(), ["sub:child-1", "sub:child-2", "tool:other-tui", "tool:stale-cache"])
  assert.deepEqual(f.read().unrelated.entries, [entry("tool:keep", "child-3")])
})

test("clear waits for storage commit before reporting success", async () => {
  const f = fixture({ root: record([entry("tool:old", "child-1")]) })
  const update = f.api.kv.update!
  let commit!: () => void
  f.api.kv.update = (key, updater) => new Promise<void>((resolve) => {
    commit = () => { update(key, updater); resolve() }
  })
  let completed = false
  const clear = clearSessionEntries(f.api, "root", []).then(() => { completed = true })
  await Promise.resolve()
  assert.equal(completed, false)
  assert.equal(f.read().root.entries.length, 1)
  commit()
  await clear
  assert.equal(completed, true)
  assert.deepEqual(f.read().root.entries, [])
})

test("storage failures reject without erasing saved entries or reporting success", async () => {
  for (const asynchronous of [false, true]) {
    const f = fixture({ root: record([entry("tool:old", "child-1")]) })
    f.api.kv.update = () => {
      if (asynchronous) return Promise.reject(new Error("disk failure"))
      throw new Error("disk failure")
    }
    await assert.rejects(clearSessionEntries(f.api, "root", []), /disk failure/)
    assert.equal(f.read().root.entries.length, 1)
  }
})

test("V1 fallback keeps tombstones, repeat clear is idempotent and new subagents still appear", async () => {
  const f = fixture({ root: record([entry("tool:old", "child-1")]) }, false)
  const cached = [entry("tool:old", "child-1")]
  assert.equal(await clearSessionEntries(f.api, "root", cached), 1)
  const ids = f.read().root.clearedIds
  assert.equal(await clearSessionEntries(f.api, "root", cached), 0)
  assert.deepEqual(f.read().root.clearedIds, ids)
  const fresh = entry("tool:fresh", "new-child")
  const merged = mergeSubEntriesForPersist([], [fresh], ids)
  assert.deepEqual([...merged.values()], [fresh])
})

test("unavailable host history and local database do not prevent clearing saved entries", async () => {
  const f = fixture({ root: record([entry("tool:old", "child-1")]) })
  f.api.session.messages = () => { throw new Error("history unavailable") }
  f.api.session.listChildren = () => { throw new Error("db unavailable") }
  await clearSessionEntries(f.api, "root", [])
  assert.deepEqual(f.read().root.entries, [])
  assert.deepEqual(f.read().root.clearedIds, ["tool:old", "sub:child-1"])
})
