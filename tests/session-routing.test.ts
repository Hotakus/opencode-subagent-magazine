import assert from "node:assert/strict"
import test from "node:test"
import { isDirectChildSession, resolveRootSessionId, walkSessionTree } from "../src/panel/session-routing"

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

const chain: Record<string, { parentID?: string }> = {
  d2: { parentID: "d1" },
  d3: { parentID: "d2" },
  d4: { parentID: "d3" },
  d5: { parentID: "d4" },
}
const cyc: Record<string, { parentID?: string }> = {
  c1: { parentID: "c2" },
  c2: { parentID: "c1" },
}
const getSession = (id: string) => chain[id]
const getCyclic = (id: string) => cyc[id]

test("walks parentID chains up to depth 5 with cycle guard", () => {
  assert.equal(isDirectChildSession("d1", "d5", { parentID: "d4" }, getSession), true)
  assert.equal(isDirectChildSession("d2", "d5", undefined, getSession), true)
  assert.equal(isDirectChildSession("x", "c1", undefined, getCyclic), false)
  assert.deepEqual(resolveRootSessionId("d5", getSession), {
    rootSid: "d1",
    isChild: true,
    ancestorIds: ["d4", "d3", "d2", "d1"],
  })
  assert.deepEqual(resolveRootSessionId("c1", getCyclic), {
    rootSid: "c2",
    isChild: true,
    ancestorIds: ["c2"],
  })
})

test("walks the session tree breadth-first with cycle guard", () => {
  const kids: Record<string, (string | undefined)[]> = {
    d1: ["d2"],
    d2: ["d3", undefined],
    d3: ["d4"],
    d4: ["d5", "d2"],
    d5: [],
  }
  const branchingKids: Record<string, (string | undefined)[]> = {
    d1: ["d2", "sibling"],
    d2: ["d3"],
    d3: [],
    sibling: ["leaf"],
    leaf: [],
  }
  assert.deepEqual(walkSessionTree("d1", (sid) => branchingKids[sid] ?? []), ["d1", "d2", "sibling", "d3", "leaf"])
  assert.deepEqual(walkSessionTree("d1", (s) => kids[s] ?? []), ["d1", "d2", "d3", "d4", "d5"])
  assert.deepEqual(walkSessionTree("c1", (s) => (s === "c1" ? ["c2"] : ["c1"])), ["c1", "c2"])
})
