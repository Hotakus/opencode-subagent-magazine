import assert from "node:assert/strict"
import test from "node:test"
import type { PanelEvent } from "../src/panel/panel-api"
import { createPanelApi } from "../src/v2/v2-panel-api"
import type { Context } from "../src/v2/types"

test("V2 step events retain session ownership through the message.updated adapter", () => {
  const handlers = new Map<string, (event: unknown) => void>()
  const context = { data: {
    on: (type: string, cb: (event: unknown) => void) => {
      handlers.set(type, cb)
      return () => { handlers.delete(type) }
    },
  } } as unknown as Context
  const api = createPanelApi(context, { lang: () => "en", maxEntries: () => 10, sortOrder: () => "desc", scrollMode: () => "wheel" })
  const events: PanelEvent[] = []
  const unsubscribe = api.event.on("message.updated", (event) => events.push(event))
  for (const type of ["session.step.started", "session.step.ended", "session.step.failed"]) {
    handlers.get(type)!({ type, data: { sessionID: "other-session" } })
  }
  assert.equal(events.length, 3)
  for (const event of events) {
    assert.deepEqual(event, { type: "message.updated", scope: "global", payload: { sessionID: "other-session" } })
  }
  unsubscribe()
  assert.equal(handlers.size, 0)
})
