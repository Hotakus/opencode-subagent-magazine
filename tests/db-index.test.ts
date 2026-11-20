import assert from "node:assert/strict"
import test from "node:test"
import { contextTokens, createSessionDbIndex, findDbPath, isSessionActive, modelIdOf, statusOfChild } from "../src/v2/db"
import type { SqlDatabase } from "../src/v2/db"

test("contextTokens mirrors the host readSessionTokens semantics", () => {
  assert.equal(contextTokens({ input: 10, output: 5, reasoning: 1, cache: { read: 100, write: 2 } }), 118)
  assert.equal(contextTokens({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }), undefined)
  assert.equal(contextTokens(undefined), undefined)
  assert.equal(contextTokens("nope"), undefined)
})

test("statusOfChild only settles sessions whose time_idle is recorded", () => {
  assert.equal(statusOfChild(undefined), undefined)
  assert.equal(statusOfChild({ id: "ses_a" }), undefined)
  assert.equal(statusOfChild({ id: "ses_a", timeIdle: 123, idleOutcome: "succeeded" }), "done")
  assert.equal(statusOfChild({ id: "ses_a", timeIdle: 123, idleOutcome: "interrupted" }), "cancelled")
  assert.equal(statusOfChild({ id: "ses_a", timeIdle: 123 }), "done")
})

test("isSessionActive treats post-idle activity as running (resumed sessions)", () => {
  // Resumed session: old time_idle, newer assistant message.
  assert.equal(isSessionActive({ timeIdle: 100, lastMessageType: "assistant", lastMessageAt: 200 }), true)
  // Stopped: the last message is the idle marker.
  assert.equal(isSessionActive({ timeIdle: 200, lastMessageType: "idle", lastMessageAt: 200 }), false)
  // Never idled but has activity.
  assert.equal(isSessionActive({ lastMessageType: "assistant", lastMessageAt: 200 }), true)
  // No messages at all.
  assert.equal(isSessionActive({}), false)
  // Last message predates the recorded idle.
  assert.equal(isSessionActive({ timeIdle: 300, lastMessageType: "assistant", lastMessageAt: 200 }), false)
})

test("statusOfChild stays unsettled while a session is active again", () => {
  assert.equal(statusOfChild({ id: "ses_a", timeIdle: 100, active: true, idleOutcome: "succeeded" }), undefined)
  assert.equal(statusOfChild({ id: "ses_a", timeIdle: 100, active: false, idleOutcome: "succeeded" }), "done")
})

test("modelIdOf accepts both string and object model shapes", () => {
  assert.equal(modelIdOf("gpt-5.6-luna"), "gpt-5.6-luna")
  assert.equal(modelIdOf({ id: "gpt-5.6-luna", providerID: "openai" }), "gpt-5.6-luna")
  assert.equal(modelIdOf(""), undefined)
  assert.equal(modelIdOf(undefined), undefined)
})

test("modelIdOf extracts the id from serialized JSON (session_v2.model)", () => {
  assert.equal(modelIdOf('{"id":"deepseek-flash","providerID":"deepseek"}'), "deepseek-flash")
  assert.equal(modelIdOf('  {"id":"gpt-5.6-luna"}  '), "gpt-5.6-luna")
  assert.equal(modelIdOf("{broken json"), undefined)
  assert.equal(modelIdOf('{"providerID":"deepseek"}'), undefined)
})

test("findDbPath honours OPENCODE_DB and XDG_DATA_HOME", () => {
  assert.equal(findDbPath({ OPENCODE_DB: "/tmp/custom.db" }, "/home/x"), "/tmp/custom.db")
  assert.equal(findDbPath({ XDG_DATA_HOME: "/data" }, "/home/x"), "/data/opencode/opencode.db")
  assert.equal(findDbPath({}, "/home/x"), "/home/x/.local/share/opencode/opencode.db")
})

test("the db index stays inert when bun:sqlite is unavailable", () => {
  // Node/CI has no bun:sqlite; every lookup must fall back silently.
  const index = createSessionDbIndex(() => true)
  assert.equal(index?.resolveCall("ses_parent", "call_1"), undefined)
  assert.equal(index?.matchChild("ses_parent", "bud-coder", Date.now()), undefined)
  assert.equal(index?.info("ses_child"), undefined)
})

const row = (n: number) => ({ id: "ses_d" + n, parent_id: "ses_d" + (n - 1), agent: "worker-d" + n, time_created: n * 1000 })
const call = (n: number) => ({ call_id: "call_d" + n, child_sid: "ses_d" + n })
const calls: Record<string, any[]> = { ses_d1: [call(2)], ses_d2: [call(3)], ses_d3: [call(4)], ses_d4: [call(5)] }
// The tree statement answers with every descendant of the root at once; the recursion and the cycle guard are inside the SQL.
const tree: Record<string, any[]> = { ses_d1: [row(2), row(3), row(4), row(5)] }
const fakeDb: SqlDatabase = { query: (sql) => ({ all: (id) => (sql.includes("WITH RECURSIVE") ? tree : sql.includes("json_each") ? calls : ({} as Record<string, any[]>))[String(id)] ?? [], get: () => undefined }) }

test("lists and matches descendants up to depth 5; a call resolves in the session that made it", () => {
  const index = createSessionDbIndex(() => true, fakeDb)!
  assert.deepEqual(index.children("ses_d1")?.map((c) => c.id), ["ses_d2", "ses_d3", "ses_d4", "ses_d5"])
  assert.equal(index.children("ses_d1")?.find((c) => c.id === "ses_d5")?.parentId, "ses_d4")
  assert.equal(index.resolveCall("ses_d4", "call_d5"), "ses_d5")
  assert.equal(index.resolveCall("ses_d1", "call_d5"), undefined)
  assert.equal(index.matchChild("ses_d1", "worker-d5", 5000), "ses_d5")
  assert.equal(index.peek("ses_d5")?.parentId, "ses_d4")
})
