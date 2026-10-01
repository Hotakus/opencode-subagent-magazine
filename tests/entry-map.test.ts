import assert from "node:assert/strict"
import test from "node:test"
import type { SubEntry } from "../src/core/types"
import { mergeSubEntriesExcludingCleared, upsertSubEntry, withoutClearedEntries } from "../src/panel/entry-map"

const entry = (id: string, sessionId: string, status: SubEntry["status"]): SubEntry => ({
  id,
  title: id,
  agent: "explore",
  prompt: id,
  sessionId,
  status,
  startedAt: 10,
})

test("continues the same child session in one entry", () => {
  let entries = new Map<string, SubEntry>()
  entries = upsertSubEntry(entries, entry("tool:first", "child-1", "done"), 20)
  entries = upsertSubEntry(entries, entry("tool:continue", "child-1", "running"), 30)

  assert.equal(entries.size, 1)
  assert.deepEqual(entries.get("tool:first"), {
    id: "tool:first",
    title: "tool:continue",
    agent: "explore",
    prompt: "tool:continue",
    sessionId: "child-1",
    status: "running",
    startedAt: 10,
    endedAt: undefined,
  })
})

test("keeps different child sessions separate", () => {
  let entries = new Map<string, SubEntry>()
  entries = upsertSubEntry(entries, entry("tool:first", "child-1", "running"))
  entries = upsertSubEntry(entries, entry("tool:second", "child-2", "running"))

  assert.equal(entries.size, 2)
})

test("restoring a terminal entry from KV keeps its persisted endedAt", () => {
  let entries = new Map<string, SubEntry>()
  entries = upsertSubEntry(
    entries,
    { ...entry("tool:done", "child-9", "done"), startedAt: 400, endedAt: 500 },
    999_999,
  )

  assert.equal(entries.get("tool:done")?.endedAt, 500)
})

test("a delayed snapshot cannot restore an entry marked as cleared", () => {
  // 场景：/subagent-clear-entries 之后，面板里仍持有清除前的旧 map，
  // debounce 写入把旧条目 merge 回 KV——清除名单必须挡住它。
  const stale = [entry("tool:cleared", "child-1", "done"), entry("sub:ses_child1", "child-1", "done")]
  const merged = mergeSubEntriesExcludingCleared([], stale, ["tool:cleared", "sub:ses_child1"])

  assert.equal(merged.size, 0)
})

test("persisting an empty snapshot heals cleared entries still in the record", () => {
  // 旧数据里已存在清除名单内的僵尸条目：下一次写入时一并剔除。
  const base = [entry("tool:zombie", "child-1", "done")]
  const merged = mergeSubEntriesExcludingCleared(base, [], ["tool:zombie"])

  assert.equal(merged.size, 0)
})

test("entries absent from the cleared list keep merging normally", () => {
  const base = [entry("tool:kept", "child-2", "running"), entry("tool:cleared", "child-1", "done")]
  const incoming = [entry("tool:kept", "child-2", "done"), entry("tool:cleared", "child-1", "running")]
  const merged = mergeSubEntriesExcludingCleared(base, incoming, ["tool:cleared"])

  assert.equal(merged.size, 1)
  assert.equal(merged.get("tool:kept")?.status, "done")
})

test("withoutClearedEntries drops cleared entries before scanning", () => {
  const map = new Map<string, SubEntry>([
    ["tool:cleared", entry("tool:cleared", "child-1", "done")],
    ["session-key", entry("tool:kept", "child-2", "done")],
  ])
  const next = withoutClearedEntries(map, new Set(["tool:cleared"]))

  assert.deepEqual([...next.keys()], ["session-key"])
})

test("withoutClearedEntries keeps everything when nothing is cleared", () => {
  const map = new Map<string, SubEntry>([["tool:kept", entry("tool:kept", "child-2", "done")]])
  const next = withoutClearedEntries(map, new Set())

  assert.equal(next.size, 1)
  assert.notEqual(next, map)
})
