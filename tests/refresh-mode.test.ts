import assert from "node:assert/strict"
import test from "node:test"
import { readRefreshMode, SETTING_KEYS, type KVApi } from "../src/core/kv"

function fakeKv(entries: Record<string, unknown>): KVApi {
  return {
    get: (key: string, fallback?: unknown) => (key in entries ? entries[key] : fallback),
    set: () => {},
  }
}

test("readRefreshMode defaults to smooth", () => {
  assert.equal(readRefreshMode(fakeKv({})), "smooth")
})

test("readRefreshMode reads stored eco and falls back for invalid values", () => {
  assert.equal(readRefreshMode(fakeKv({ [SETTING_KEYS.refreshMode]: "eco" })), "eco")
  assert.equal(readRefreshMode(fakeKv({ [SETTING_KEYS.refreshMode]: "smooth" })), "smooth")
  assert.equal(readRefreshMode(fakeKv({ [SETTING_KEYS.refreshMode]: "turbo" })), "smooth")
})
