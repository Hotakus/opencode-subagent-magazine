import assert from "node:assert/strict"
import test from "node:test"
import type { SessionRecord, SubEntry } from "../src/core/types"
import type { KVApi } from "../src/core/kv"
import { mergeSubEntries, mergeSubEntry } from "../src/panel/entry-map"
import { updateSessionData, SESSION_DATA_KEY } from "../src/core/kv"

const entry = (
  id: string,
  sessionId: string,
  status: SubEntry["status"],
  extra: Partial<SubEntry> = {},
): SubEntry => ({
  id,
  title: id,
  agent: "explore",
  prompt: id,
  sessionId,
  status,
  startedAt: 100,
  ...extra,
})

const sessionRecord = (entries: SubEntry[]): SessionRecord => ({
  ts: 1,
  entries,
  scroll: 0,
  expanded: "",
  children: {},
})

test("a terminal status never regresses to running", () => {
  const persisted = entry("tool:a", "child-1", "done", { endedAt: 500, tokens: 120 })
  const staleInstance = entry("tool:a", "child-1", "running")

  const merged = mergeSubEntry(persisted, staleInstance)

  assert.equal(merged.status, "done")
  assert.equal(merged.endedAt, 500)
  assert.equal(merged.tokens, 120)
})

test("a newer terminal status wins over running", () => {
  const running = entry("tool:a", "child-1", "running")
  const settled = entry("tool:a", "child-1", "done", { endedAt: 900, tokens: 300 })

  const merged = mergeSubEntry(running, settled)

  assert.equal(merged.status, "done")
  assert.equal(merged.endedAt, 900)
})

test("cancel_requested does not beat a terminal status", () => {
  const cancelled = entry("tool:a", "child-1", "cancelled", { endedAt: 700, abortAccepted: true })
  const stale = entry("tool:a", "child-1", "cancel_requested", { abortAccepted: true })

  const merged = mergeSubEntry(cancelled, stale)

  assert.equal(merged.status, "cancelled")
  assert.equal(merged.abortAccepted, true)
})

test("mergeSubEntries unions both sides instead of replacing", () => {
  const persisted = [entry("tool:a", "child-1", "done", { endedAt: 500 })]
  const memory = [
    entry("tool:a", "child-1", "running"),
    entry("tool:b", "child-2", "running"),
  ]

  const merged = mergeSubEntries(persisted, memory)

  assert.equal(merged.size, 2)
  assert.equal(merged.get("tool:a")?.status, "done")
  assert.equal(merged.get("tool:b")?.status, "running")
})

test("mergeSubEntries deduplicates the same child session", () => {
  const first = entry("tool:first", "child-1", "done", { endedAt: 500 })
  const continued = entry("tool:continue", "child-1", "running")

  const merged = mergeSubEntries([first], [continued])

  assert.equal(merged.size, 1)
  assert.equal(merged.get("tool:first")?.status, "done")
})

test("progress counters only grow", () => {
  const newer = entry("tool:a", "child-1", "running", { tokens: 900, cost: 0.5, todoTotal: 10, todoDone: 4 })
  const stale = entry("tool:a", "child-1", "running", { tokens: 300, cost: 0.1, todoTotal: 8, todoDone: 2 })

  const merged = mergeSubEntry(newer, stale)

  assert.equal(merged.tokens, 900)
  assert.equal(merged.cost, 0.5)
  assert.equal(merged.todoTotal, 10)
  assert.equal(merged.todoDone, 4)
})

test("startedAt keeps the earliest observed value", () => {
  const early = entry("tool:a", "child-1", "running", { startedAt: 10 })
  const late = entry("tool:a", "child-1", "done", { startedAt: 90, endedAt: 200 })

  const merged = mergeSubEntry(early, late)

  assert.equal(merged.startedAt, 10)
})

test("updateSessionData merges against the latest on-disk value via atomic update", () => {
  const disk = new Map<string, unknown>()
  const fromOtherInstance = sessionRecord([entry("tool:other", "child-9", "running")])
  disk.set(SESSION_DATA_KEY, JSON.stringify({ root: fromOtherInstance }))

  const kv: KVApi = {
    get: (key, fallback) => (disk.has(key) ? disk.get(key) : fallback),
    set: (key, value) => { disk.set(key, value) },
    update: (key, updater) => { disk.set(key, updater(disk.get(key))) },
  }

  updateSessionData(kv, (data) => {
    const rec = data.root ?? sessionRecord([])
    rec.entries = [...mergeSubEntries(rec.entries, [entry("tool:mine", "child-1", "running")]).values()]
    data.root = rec
  })

  const persisted = JSON.parse(String(disk.get(SESSION_DATA_KEY))) as Record<string, SessionRecord>
  assert.deepEqual(
    persisted.root.entries.map((e) => e.id).sort(),
    ["tool:mine", "tool:other"],
  )
})

test("updateSessionData falls back to get+set when the host has no atomic update", () => {
  const disk = new Map<string, unknown>()
  const kv: KVApi = {
    get: (key, fallback) => (disk.has(key) ? disk.get(key) : fallback),
    set: (key, value) => { disk.set(key, value) },
  }

  updateSessionData(kv, (data) => {
    data.root = sessionRecord([entry("tool:a", "child-1", "done", { endedAt: 500 })])
  })

  const persisted = JSON.parse(String(disk.get(SESSION_DATA_KEY))) as Record<string, SessionRecord>
  assert.equal(persisted.root.entries.length, 1)
  assert.equal(persisted.root.entries[0].status, "done")
})
