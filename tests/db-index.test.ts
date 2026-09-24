import assert from "node:assert/strict"
import test from "node:test"
import { contextTokens, createSessionDbIndex, findDbPath, modelIdOf, statusOfChild } from "../src/v2/db"

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
