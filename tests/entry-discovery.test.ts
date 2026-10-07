import assert from "node:assert/strict"
import test from "node:test"
import type { SubEntry } from "../src/core/types"
import { hasMissingSubagentPart } from "../src/panel/entry-discovery"
import type { PanelApi } from "../src/panel/panel-api"

function fixture(parts: unknown[]) {
  const session: PanelApi["session"] = {
    get: () => undefined, status: () => undefined,
    messages: () => [{ id: "message" }], part: () => parts,
  }
  return session
}
const part = (id: string, status = "completed", sessionId?: string) => ({
  id, type: "tool", tool: "task", state: { status, input: {} }, metadata: { sessionId },
})
const entry: SubEntry = {
  id: "tool:call", sessionId: "child", agent: "explore", title: "", prompt: "", status: "running", startedAt: 10,
}

test("cleared historical tool parts do not request rescans or query the database", () => {
  const session = fixture([part("call")])
  session.resolveChild = () => { assert.fail("an exact cleared ID must skip database lookups") }
  for (let tick = 0; tick < 20; tick++) {
    assert.equal(hasMissingSubagentPart(session, "root", new Map(), new Set(["tool:call"])), false)
  }
})

test("discovery ignores cleared child identities across every metadata spelling", () => {
  for (const key of ["session_id", "sessionId", "sessionID"]) {
    for (const atPart of [false, true]) {
      const raw = { ...part("alias"), metadata: atPart ? { [key]: "child" } : undefined,
        state: { status: "completed", metadata: atPart ? undefined : { [key]: "child" } } }
      assert.equal(hasMissingSubagentPart(fixture([raw]), "root", new Map(), new Set(["sub:child"])), false)
    }
  }
})

test("discovery resolves an unlinked historical alias before scheduling a scan", () => {
  const session = fixture([part("alias")])
  session.resolveChild = ({ parentId, callId }) => {
    assert.equal(parentId, "root"); assert.equal(callId, "alias")
    return "child"
  }
  assert.equal(hasMissingSubagentPart(session, "root", new Map(), new Set(["sub:child"])), false)
})

test("a genuinely new subagent still requests recovery after history is cleared", () => {
  const session = fixture([part("fresh", "running", "new-child")])
  assert.equal(hasMissingSubagentPart(session, "root", new Map(), new Set(["tool:old", "sub:child"])), true)
})

test("discovery still requests reconciliation for finished foreground tools with running entries", () => {
  assert.equal(hasMissingSubagentPart(fixture([part("call")]), "root", new Map([[entry.id, entry]]), new Set()), true)
})

test("settled entries and background tools do not request needless rescans", () => {
  const entries = new Map([[entry.id, { ...entry, status: "done" as const }]])
  assert.equal(hasMissingSubagentPart(fixture([part("call")]), "root", entries, new Set()), false)
  const background = { ...part("call"), state: { status: "completed", input: { background: true } } }
  assert.equal(hasMissingSubagentPart(fixture([background]), "root", new Map([[entry.id, entry]]), new Set()), false)
})

test("pending, failed and unrelated tools do not trigger recovery scans", () => {
  const session = fixture([part("pending", "pending"), part("failed", "error"), { ...part("shell"), tool: "shell" }])
  assert.equal(hasMissingSubagentPart(session, "root", new Map(), new Set()), false)
})
