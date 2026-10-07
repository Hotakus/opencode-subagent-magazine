import assert from "node:assert/strict"
import test from "node:test"
import { isCurrentSessionEvent, isDirectChildSession } from "../src/panel/session-routing"

test("does not use a sibling session for local end-event fallback", () => {
  assert.equal(
    isDirectChildSession("parent-a", "child-b", { parentID: "parent-b" }),
    false,
  )
})

test("uses a direct child session for local end-event fallback", () => {
  assert.equal(
    isDirectChildSession("parent-a", "child-a", { parentID: "parent-a" }),
    true,
  )
})

test("does not use the panel's own session or an unknown session", () => {
  assert.equal(isDirectChildSession("parent-a", "parent-a", { parentID: "parent-x" }), false)
  assert.equal(isDirectChildSession("parent-a", "child-a", undefined), false)
})
test("other sessions' global message and tool events cannot repaint or rescan this panel", () => {
  for (const type of ["message.updated", "part.updated"] as const) {
    assert.equal(isCurrentSessionEvent("root", { type, scope: "global", payload: { sessionID: "other" } }), false)
    assert.equal(isCurrentSessionEvent("root", { type, scope: "global" }), false)
    assert.equal(isCurrentSessionEvent("root", { type, scope: "global", payload: { sessionID: "root" } }), true)
    assert.equal(isCurrentSessionEvent("root", { type, scope: "session" }), true)
    assert.equal(isCurrentSessionEvent("root", { type }), true)
  }
})
