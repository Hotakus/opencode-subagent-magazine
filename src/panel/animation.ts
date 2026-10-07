import { rgb } from "../core/color"
import type { RefreshMode } from "../core/types"

/** The header stays visible while collapsed, so only idle panels stop the clock. */
export function panelClockInterval(mode: RefreshMode, active: boolean): number | undefined {
  return active ? (mode === "eco" ? 1000 : 100) : undefined
}

/** Shared two-second breathing phase for the header and every running row. */
export function breathingColor(now: number, muted: string, warning: string): string {
  const a = rgb(muted), b = rgb(warning)
  if (!a || !b || !Number.isFinite(now) ||
    ![a.r, a.g, a.b, b.r, b.g, b.b].every(Number.isFinite)) return warning
  const phase = (1 - Math.cos((now % 2000) / 2000 * Math.PI * 2)) / 2
  const blend = (from: number, to: number) => Math.max(0, Math.min(255, Math.round(from + (to - from) * phase)))
  return "#" + [blend(a.r, b.r), blend(a.g, b.g), blend(a.b, b.b)]
    .map((value) => value.toString(16).padStart(2, "0")).join("")
}
