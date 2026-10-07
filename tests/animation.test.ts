import assert from "node:assert/strict"
import test from "node:test"
import { breathingColor, panelClockInterval } from "../src/panel/animation"

test("active panels use the smooth or eco clock even when only the header is visible", () => {
  assert.equal(panelClockInterval("smooth", true), 100)
  assert.equal(panelClockInterval("eco", true), 1000)
})

test("idle panels do not run an animation clock in either refresh mode", () => {
  assert.equal(panelClockInterval("smooth", false), undefined)
  assert.equal(panelClockInterval("eco", false), undefined)
})

test("running status breathes through the original two-second cycle", () => {
  assert.equal(breathingColor(0, "#202020", "#e0e0e0"), "#202020")
  assert.equal(breathingColor(500, "#202020", "#e0e0e0"), "#808080")
  assert.equal(breathingColor(1000, "#202020", "#e0e0e0"), "#e0e0e0")
  assert.equal(breathingColor(1500, "#202020", "#e0e0e0"), "#808080")
  assert.equal(breathingColor(2000, "#202020", "#e0e0e0"), "#202020")
})

test("smooth has intermediate colors while eco keeps coarse one-second updates", () => {
  const colors = (step: number) => new Set(Array.from({ length: 2000 / step }, (_, i) =>
    breathingColor(i * step, "#202020", "#e0e0e0")))
  assert.ok(colors(100).size > 5)
  assert.equal(colors(1000).size, 2)
})

test("malformed theme colors or time fall back safely without NaN color output", () => {
  assert.equal(breathingColor(100, "not-a-color", "#e0e0e0"), "#e0e0e0")
  assert.equal(breathingColor(100, "#invalid", "#e0e0e0"), "#e0e0e0")
  assert.equal(breathingColor(NaN, "#202020", "#e0e0e0"), "#e0e0e0")
})
