import type { TimeFormat } from "./types"

/** Visual width of a single character (CJK/wide chars count as 2). */
function charColumns(c: string): number {
  const code = c.codePointAt(0) ?? 0
  if (code < 0x20) return 0
  if (code < 0x7f) return 1
  if (code < 0xa0) return 0
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
    return 2
  return 1
}

export function visualWidth(s: string): number {
  let w = 0
  for (const c of s) w += charColumns(c)
  return w
}

export function truncate(text: string, maxCols: number): string {
  if (visualWidth(text) <= maxCols) return text
  let cols = 0
  let i = 0
  for (const c of text) {
    const w = charColumns(c)
    if (cols + w > maxCols - 1) break
    cols += w
    i += c.length
  }
  return text.slice(0, i) + "\u2026"
}

export function fmtDurationShort(ms: number, running: boolean): string {
  if (running && ms < 2000) return ""
  if (ms < 1000) return (ms / 1000).toFixed(2) + "s"
  if (ms < 60000) return (ms / 1000).toFixed(2) + "s"
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m${s}s`
}

/** All supported elapsed-time display modes, in picker order. */
export const TIME_FORMATS: readonly TimeFormat[] = ["short", "decimal", "clock", "compact", "seconds"]

/** Neutral samples shown in the time-format picker (language independent). */
export const TIME_FORMAT_SAMPLES: Record<TimeFormat, string> = {
  decimal: "45.3s · 9.5m · 1.9h",
  short: "45.32s · 112m35s",
  clock: "0:45 · 1:52:35",
  compact: "45s · 1h52m",
  seconds: "45s · 6755s",
}

/** Formats elapsed milliseconds using the configured display mode. */
export function fmtDuration(ms: number, running: boolean, mode: TimeFormat = "short"): string {
  if (running && ms < 2000) return ""
  const t = Number.isFinite(ms) && ms > 0 ? ms : 0
  switch (mode) {
    case "short":
      return fmtDurationShort(t, false)
    case "compact": {
      if (t < 60000) return `${Math.floor(t / 1000)}s`
      if (t < 3600000) return `${Math.floor(t / 60000)}m${Math.floor((t % 60000) / 1000)}s`
      return `${Math.floor(t / 3600000)}h${Math.floor((t % 3600000) / 60000)}m`
    }
    case "clock": {
      const s = Math.floor((t % 60000) / 1000)
      if (t < 3600000) return `${Math.floor(t / 60000)}:${String(s).padStart(2, "0")}`
      const m = Math.floor((t % 3600000) / 60000)
      return `${Math.floor(t / 3600000)}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    }
    case "seconds":
      return `${Math.floor(t / 1000)}s`
    case "decimal":
    default: {
      // Promote units when rounding would show "60.0s" / "60.0m".
      if (t < 59950) return `${(t / 1000).toFixed(1)}s`
      if (t < 3597000) return `${(t / 60000).toFixed(1)}m`
      return `${(t / 3600000).toFixed(1)}h`
    }
  }
}

export function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1000000).toFixed(1)}M`
}

export function safeErrorMsg(err: unknown): string {
  if (!err) return ""
  if (typeof err === "string") return err
  if (typeof err === "object") return String((err as any).message || (err as any).code || "")
  return ""
}
