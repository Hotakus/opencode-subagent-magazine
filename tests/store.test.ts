import assert from "node:assert/strict"
import test from "node:test"
import { clearNotice, notifySessionCleared } from "../src/panel/store"

test("clear notifications identify the cleared panel without resetting every session's view", () => {
  const previous = clearNotice()?.revision ?? 0
  notifySessionCleared("child-panel")
  assert.deepEqual(clearNotice(), { sessionId: "child-panel", revision: previous + 1 })
  notifySessionCleared("parent-panel")
  assert.deepEqual(clearNotice(), { sessionId: "parent-panel", revision: previous + 2 })
})
