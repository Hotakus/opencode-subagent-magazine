/** Morandi palette helpers — desaturate any theme color toward a muted fallback. */

export function rgb(raw: unknown): { r: number; g: number; b: number } | null {
  if (typeof raw === "string" && raw.startsWith("#")) {
    const h = raw.slice(1)
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    }
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>
    if (typeof o.r === "number" && typeof o.g === "number" && typeof o.b === "number") {
      const scale = o.r > 1 || o.g > 1 || o.b > 1 ? 1 : 255
      return { r: Math.round(o.r * scale), g: Math.round(o.g * scale), b: Math.round(o.b * scale) }
    }
  }
  return null
}

/** Preserve alpha from both hex colours and the host's RGBA objects. */
function alpha(raw: unknown): number {
  if (typeof raw === "string" && raw.startsWith("#") && raw.length === 9) {
    return parseInt(raw.slice(7), 16)
  }
  if (raw && typeof raw === "object") {
    const a = (raw as { a?: unknown }).a
    if (typeof a === "number" && Number.isFinite(a)) {
      return Math.round(Math.max(0, Math.min(1, a)) * 255)
    }
  }
  return 255
}

function toHex(r: number, g: number, b: number, a = 255): string {
  const channels = a === 255 ? [r, g, b] : [r, g, b, a]
  return "#" + channels.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")
}

/** RGB interpolation with alpha retained (for animated status colours). */
export function mixColors(first: unknown, second: unknown, t: number): string | null {
  const a = rgb(first), b = rgb(second)
  if (!a || !b) return null
  return toHex(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
    alpha(first) + (alpha(second) - alpha(first)) * t,
  )
}

export function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const delta = max - min
  if (delta === 0) return 0
  const L = (max + min) / 2
  return L <= 0.5 ? delta / (max + min) : delta / (2 - max - min)
}

function desaturateTo(raw: unknown, maxSat: number, fallback: string): string {
  const c = rgb(raw)
  if (!c) return fallback
  const sat = saturation(c.r, c.g, c.b)
  if (sat <= maxSat) {
    return toHex(c.r, c.g, c.b, alpha(raw))
  }
  const luma = c.r * 0.299 + c.g * 0.587 + c.b * 0.114
  let lo = 0, hi = 1
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    const nr = Math.round(c.r + (luma - c.r) * mid)
    const ng = Math.round(c.g + (luma - c.g) * mid)
    const nb = Math.round(c.b + (luma - c.b) * mid)
    if (saturation(nr, ng, nb) > maxSat) lo = mid
    else hi = mid
  }
  const nr = Math.round(c.r + (luma - c.r) * hi)
  const ng = Math.round(c.g + (luma - c.g) * hi)
  const nb = Math.round(c.b + (luma - c.b) * hi)
  return toHex(nr, ng, nb, alpha(raw))
}

function dimColor(hex: string, factor = 0.5): string {
  const c = rgb(hex)
  if (!c) return hex
  const r = Math.round(c.r * factor)
  const g = Math.round(c.g * factor)
  const b = Math.round(c.b * factor)
  return toHex(r, g, b, alpha(hex))
}

export const FALLBACK = {
  primary: "#8B9DAF", text: "#C5C5BB", muted: "#7A7A72",
  success: "#9CAF8B", warning: "#C5B88D", error: "#B08A8A", border: "#6B6B63",
} as const

export const MAX_SAT = 0.28

export { desaturateTo, dimColor }
