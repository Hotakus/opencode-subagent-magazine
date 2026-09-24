import assert from "node:assert/strict"
import test from "node:test"
import { fmtDuration, TIME_FORMATS, TIME_FORMAT_SAMPLES } from "../src/core/format"

test("fmtDuration short is the default and keeps the legacy format", () => {
  assert.equal(fmtDuration(45_320, false), "45.32s")
  assert.equal(fmtDuration(6_755_000, false), "112m35s")
  assert.equal(fmtDuration(45_320, false, "short"), "45.32s")
})

test("fmtDuration decimal uses one decimal and promotes units on rounding", () => {
  assert.equal(fmtDuration(45_300, false, "decimal"), "45.3s")
  assert.equal(fmtDuration(570_000, false, "decimal"), "9.5m")
  assert.equal(fmtDuration(6_840_000, false, "decimal"), "1.9h")
  // 59.95s would round to "60.0s" — promote to minutes instead.
  assert.equal(fmtDuration(59_950, false, "decimal"), "1.0m")
  // 59.95m would round to "60.0m" — promote to hours instead.
  assert.equal(fmtDuration(3_597_000, false, "decimal"), "1.0h")
  assert.equal(fmtDuration(3_599_500, false, "decimal"), "1.0h")
})

test("fmtDuration clock renders mm:ss and h:mm:ss", () => {
  assert.equal(fmtDuration(45_000, false, "clock"), "0:45")
  assert.equal(fmtDuration(572_000, false, "clock"), "9:32")
  assert.equal(fmtDuration(6_755_000, false, "clock"), "1:52:35")
})

test("fmtDuration compact drops leading units once promoted", () => {
  assert.equal(fmtDuration(45_900, false, "compact"), "45s")
  assert.equal(fmtDuration(572_000, false, "compact"), "9m32s")
  assert.equal(fmtDuration(6_755_000, false, "compact"), "1h52m")
})

test("fmtDuration seconds always uses whole seconds", () => {
  assert.equal(fmtDuration(45_000, false, "seconds"), "45s")
  assert.equal(fmtDuration(6_755_000, false, "seconds"), "6755s")
})

test("fmtDuration hides very fresh running entries and clamps invalid input", () => {
  assert.equal(fmtDuration(1_500, true), "")
  assert.equal(fmtDuration(2_000, true), "2.00s")
  assert.equal(fmtDuration(Number.NaN, false), "0.00s")
  assert.equal(fmtDuration(-5, false), "0.00s")
})

test("short is the first mode and every mode has a printable sample", () => {
  assert.equal(TIME_FORMATS[0], "short")
  for (const mode of TIME_FORMATS) {
    assert.equal(typeof TIME_FORMAT_SAMPLES[mode], "string")
    assert.ok(TIME_FORMAT_SAMPLES[mode].length > 0)
  }
})
