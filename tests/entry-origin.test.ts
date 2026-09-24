import assert from "node:assert/strict"
import test from "node:test"
import { isBackgroundInput } from "../src/core/types"

test("isBackgroundInput accepts both V1 and V2 background flags", () => {
  assert.equal(isBackgroundInput({ background: true }), true)
  assert.equal(isBackgroundInput({ run_in_background: true }), true)
  assert.equal(isBackgroundInput({ background: false, run_in_background: false }), false)
  assert.equal(isBackgroundInput({ prompt: "x" }), false)
  assert.equal(isBackgroundInput(undefined), false)
  assert.equal(isBackgroundInput("background"), false)
})
