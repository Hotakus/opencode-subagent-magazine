import assert from "node:assert/strict"
import test from "node:test"
import type { SubEntry } from "../src/core/types"
import { CALL_WINDOW_TOLERANCE_MS, callWindowUsage, type WindowMessage } from "../src/core/usage"
import { findSubEntryKey, mergeSubEntries, upsertSubEntry } from "../src/panel/entry-map"
import { toWindowMessage } from "../src/v2/db"

const entry = (id: string, sessionId: string, status: SubEntry["status"], extra: Partial<SubEntry> = {}): SubEntry => ({
  id,
  title: id,
  agent: "general",
  prompt: id,
  sessionId,
  status,
  startedAt: 10,
  origin: id.startsWith("sub:") ? "sub" : "tool",
  ...extra,
})

test("per-call entries continuing one child session stay in separate rows", () => {
  let entries = new Map<string, SubEntry>()
  entries = upsertSubEntry(entries, entry("tool:first", "child-1", "done", { perCall: true, startedAt: 100 }), 200)
  entries = upsertSubEntry(entries, entry("tool:second", "child-1", "running", { perCall: true, startedAt: 300 }), 300)

  assert.deepEqual([...entries.keys()], ["tool:first", "tool:second"])
  assert.equal(entries.get("tool:first")?.status, "done")
  assert.equal(entries.get("tool:second")?.startedAt, 300)
})

test("a per-call entry replaces the spawned-session row of its child", () => {
  let entries = new Map<string, SubEntry>([["sub:child-1", entry("sub:child-1", "child-1", "done", { startedAt: 1, endedAt: 999 })]])
  entries = upsertSubEntry(entries, entry("tool:call", "child-1", "running", { perCall: true, startedAt: 500 }), 500)

  assert.deepEqual([...entries.keys()], ["tool:call"])
  assert.equal(entries.get("tool:call")?.status, "running")
  assert.equal(entries.get("tool:call")?.startedAt, 500)
  assert.equal(entries.get("tool:call")?.endedAt, undefined)
  // The next event for the same call finds it by id.
  assert.equal(findSubEntryKey(entries, "tool:call", "child-1", true), "tool:call")
})

test("default mode keeps merging continuations but leaves per-call rows alone", () => {
  let entries = new Map<string, SubEntry>([["tool:split", entry("tool:split", "child-1", "done", { perCall: true })]])
  entries = upsertSubEntry(entries, entry("tool:a", "child-1", "done"), 20)
  entries = upsertSubEntry(entries, entry("tool:b", "child-1", "running"), 30)

  assert.deepEqual([...entries.keys()], ["tool:split", "tool:a"])
  assert.equal(entries.get("tool:a")?.title, "tool:b")
})

test("persisted merge keeps per-call rows of the same child apart", () => {
  const base = [entry("tool:first", "child-1", "done", { perCall: true, tokens: 10, cost: 1 })]
  const incoming = [
    entry("tool:first", "child-1", "done", { perCall: true, tokens: 10, cost: 1 }),
    entry("tool:second", "child-1", "running", { perCall: true }),
  ]
  const merged = mergeSubEntries(base, incoming)

  assert.deepEqual([...merged.keys()], ["tool:first", "tool:second"])
  assert.equal(merged.get("tool:first")?.perCall, true)
})

// Child session of a sub-agent continued twice: three rounds.
const rounds: WindowMessage[] = [
  { type: "user", at: 1_000 },
  { type: "assistant", at: 2_000, cost: 0.5, tokens: 100, model: "sol" },
  { type: "assistant", at: 3_000, cost: 0.25, tokens: 150, model: "sol" },
  { type: "idle", at: 4_000, outcome: "succeeded" },
  { type: "user", at: 60_000 },
  { type: "assistant", at: 61_000, cost: 1, tokens: 400, model: "sol-high" },
  { type: "idle", at: 70_000, outcome: "interrupted" },
  { type: "user", at: 120_000 },
  { type: "assistant", at: 121_000, cost: 2, tokens: 500, model: "sol" },
]

test("callWindowUsage measures only the round started by the call", () => {
  assert.deepEqual(callWindowUsage(rounds, 900), {
    endedAt: 4_000, outcome: "succeeded", tokens: 150, cost: 0.75, model: "sol",
  })
  assert.deepEqual(callWindowUsage(rounds, 59_500), {
    endedAt: 70_000, outcome: "interrupted", tokens: 400, cost: 1, model: "sol-high",
  })
})

test("callWindowUsage reports an open round as still running", () => {
  const usage = callWindowUsage(rounds, 119_000)
  assert.equal(usage?.endedAt, undefined)
  assert.equal(usage?.cost, 2)
  assert.equal(usage?.tokens, 500)
})

test("callWindowUsage waits when the child has not started the round yet", () => {
  assert.equal(callWindowUsage(rounds, 200_000), undefined)
  assert.equal(callWindowUsage(rounds, 60_000 + CALL_WINDOW_TOLERANCE_MS + 1), undefined)
})

test("callWindowUsage leaves cost unset for a round without assistant replies", () => {
  const usage = callWindowUsage([{ type: "user", at: 10 }, { type: "idle", at: 20, outcome: "failed" }], 10)
  assert.deepEqual(usage, { endedAt: 20, outcome: "failed" })
})

test("toWindowMessage keeps tokens only for assistant replies with output", () => {
  assert.deepEqual(
    toWindowMessage({ type: "assistant", at: 5, cost: 0.1, tokens: { input: 1, output: 2, cache: { read: 7 } }, model: { id: "m" } }),
    { type: "assistant", at: 5, cost: 0.1, tokens: 10, model: "m" },
  )
  assert.deepEqual(toWindowMessage({ type: "assistant", at: 5, tokens: { input: 9, output: 0 } }), { type: "assistant", at: 5 })
  assert.deepEqual(toWindowMessage({ type: "idle", at: 6, outcome: "succeeded" }), { type: "idle", at: 6, outcome: "succeeded" })
  assert.equal(toWindowMessage({ type: "user", at: "x" }), undefined)
})
