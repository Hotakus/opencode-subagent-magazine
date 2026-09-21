import assert from "node:assert/strict"
import test from "node:test"
import type { SubEntry } from "../src/core/types"
import { upsertSubEntry } from "../src/panel/entry-map"

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
