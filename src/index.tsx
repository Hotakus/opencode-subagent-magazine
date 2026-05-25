/** @jsxImportSource @opentui/solid */

import type { JSX } from "@opentui/solid"
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiSlotContext,
  TuiSlotPlugin,
  TuiPluginModule,
  TuiThemeCurrent,
} from "@opencode-ai/plugin/tui"
import {
  createMemo,
  createSignal,
  onMount,
  onCleanup,
  Show,
  For,
} from "solid-js"
import { PLUGIN_VERSION } from "./_version"

// ===================================================================
// Types
// ===================================================================

type SubStatus = "running" | "done" | "error"

interface SubEntry {
  id: string
  agent: string
  prompt: string
  command?: string
  model?: string
  status: SubStatus
  startedAt: number
  endedAt?: number
}

// ===================================================================
// Helpers — visual width
// ===================================================================

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

function visualWidth(s: string): number {
  let w = 0
  for (const c of s) w += charColumns(c)
  return w
}

function truncate(text: string, maxCols: number): string {
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

function fmtDurationShort(ms: number, running: boolean): string {
  if (running && ms < 2000) return ""
  if (ms < 1000) return (ms / 1000).toFixed(1) + "s"
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s"
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m${s}s`
}

// ===================================================================
// Color helpers — Morandi palette
// ===================================================================

function rgb(raw: unknown): { r: number; g: number; b: number } | null {
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

function saturation(r: number, g: number, b: number): number {
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
    return "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")
  }
  const luma = c.r * 0.299 + c.g * 0.587 + c.b * 0.114
  let lo = 0, hi = 1
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    const nr = Math.round(c.r + (luma - c.r) * mid)
    const ng = Math.round(c.g + (luma - c.g) * mid)
    const nb = Math.round(c.b + (luma - c.b) * hi)
    if (saturation(nr, ng, nb) > maxSat) lo = mid
    else hi = mid
  }
  const nr = Math.round(c.r + (luma - c.r) * hi)
  const ng = Math.round(c.g + (luma - c.g) * hi)
  const nb = Math.round(c.b + (luma - c.b) * hi)
  return "#" + [nr, ng, nb].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
}

const FALLBACK = {
  primary: "#8B9DAF", text: "#C5C5BB", muted: "#7A7A72",
  success: "#9CAF8B", warning: "#C5B88D", error: "#B08A8A", border: "#6B6B63",
} as const

const MAX_SAT = 0.28

// ===================================================================
// Sidebar component
// ===================================================================

function SubAgentPanel(props: {
  theme: TuiThemeCurrent
  api: TuiPluginApi
}): JSX.Element {
  const [panelWidth, setPanelWidth] = createSignal(28)
  const [open, setOpen] = createSignal(true)
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [now, setNow] = createSignal(Date.now())
  const [entryMap, setEntryMap] = createSignal<Map<string, SubEntry>>(new Map())

  let boxEl: any

  // ── upsert ──
  const upsertEntry = (
    partial: Omit<SubEntry, "startedAt" | "endedAt"> & { startedAt?: number }
  ) => {
    setEntryMap((prev) => {
      const existing = prev.get(partial.id)
      const next = new Map(prev)
      const nowTs = Date.now()
      const status = partial.status
      const ended = status === "done" || status === "error"
      next.set(partial.id, {
        ...(existing ?? { startedAt: nowTs }),
        ...partial,
        startedAt: existing?.startedAt ?? partial.startedAt ?? nowTs,
        endedAt: ended ? (existing?.endedAt ?? nowTs) : undefined,
      })
      return next
    })
  }

  // ── event handlers ──
  const handlePartUpdated = (event: unknown) => {
    const e = event as Record<string, unknown>
    const props_ = e.properties as Record<string, unknown> | undefined
    const part = props_?.part as Record<string, unknown> | undefined
    if (!part) return

    // SubtaskPart
    if (part.type === "subtask") {
      const agent = String(part.agent ?? "?")
      const prompt = String(part.prompt ?? part.description ?? "")
      const command = part.command !== undefined ? String(part.command) : undefined
      const modelRec = part.model as { providerID?: string; modelID?: string } | undefined
      const model = modelRec?.providerID && modelRec?.modelID
        ? `${modelRec.providerID}/${modelRec.modelID}`
        : undefined
      const id = `sub:${String(part.id ?? crypto.randomUUID())}`
      upsertEntry({ id, agent, prompt, command, model, status: "running" })
    }

    // ToolPart
    if (part.type === "tool") {
      const tool = String(part.tool ?? "")
      if (tool !== "task" && tool !== "delegate") return
      const state = part.state as Record<string, unknown> | undefined
      const rawStatus = String(state?.status ?? "")
      let status: SubStatus = "running"
      if (rawStatus === "completed") status = "done"
      else if (rawStatus === "error") status = "error"
      const input = state?.input as Record<string, unknown> | undefined
      const agent = String(part.subagent_type ?? input?.subagent_type ?? tool)
      const prompt = String(input?.description ?? input?.prompt ?? part.description ?? "")
      const command = input?.command !== undefined ? String(input.command) : undefined
      const id = `tool:${String(part.id ?? crypto.randomUUID())}`
      upsertEntry({ id, agent, prompt, command, status })
    }
  }

  const handleSessionEnd = (event: unknown, status: SubStatus) => {
    const e = event as Record<string, unknown>
    const props_ = e.properties as Record<string, unknown> | undefined
    const sessionID = String(props_?.sessionID ?? "")
    if (!sessionID) return
    setEntryMap((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const [id, entry] of next) {
        if (entry.status === "running" && id.includes(sessionID)) {
          next.set(id, { ...entry, status, endedAt: Date.now() })
          changed = true
        }
      }
      return changed ? next : prev
    })
  }

  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)

    const unsubPart = props.api.event.on("message.part.updated", handlePartUpdated)
    const unsubIdle = props.api.event.on("session.idle", (e) => handleSessionEnd(e, "done"))
    const unsubError = props.api.event.on("session.error", (e) => handleSessionEnd(e, "error"))

    onCleanup(() => {
      clearInterval(timer)
      unsubPart()
      unsubIdle()
      unsubError()
    })
  })

  // ── palette ──
  const pal = createMemo(() => {
    const t = props.theme as Record<string, unknown>
    const sat = (k: string, fb: string) => desaturateTo(t[k], MAX_SAT, fb)
    return {
      primary: sat("primary", FALLBACK.primary),
      text: sat("text", FALLBACK.text),
      muted: sat("textMuted", FALLBACK.muted),
      success: sat("success", FALLBACK.success),
      warning: sat("warning", FALLBACK.warning),
      error: sat("error", FALLBACK.error),
      border: sat("border", FALLBACK.border),
    }
  })

  // ── derived signals ──
  const entries = createMemo(() => {
    const nowVal = now()
    return [...entryMap().values()]
      .map((e) => ({
        ...e,
        elapsed: (e.endedAt ?? nowVal) - e.startedAt,
      }))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "running" ? -1 : 1
        if (a.status === "running") return a.startedAt - b.startedAt
        return (b.endedAt ?? 0) - (a.endedAt ?? 0)
      })
  })

  const doneCount = createMemo(() => entries().filter((e) => e.status === "done").length)
  const runningCount = createMemo(() => entries().filter((e) => e.status === "running").length)
  const errCount = createMemo(() => entries().filter((e) => e.status === "error").length)
  const anyEntry = () => entries().length > 0

  const maxElapsed = createMemo(() => {
    const vals = entries().map((e) => e.elapsed)
    return vals.length ? Math.max(...vals) : 0
  })

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sep = () => "\u2500".repeat(Math.max(1, panelWidth() - 4))

  // ── decomposed header parts for colored spans ──
  const openIcon = () => open() ? "\u25bc" : "\u25b6"
  const versionStr = () => open() ? ` v${PLUGIN_VERSION}` : ""
  const summaryDot = () => "\u25cf"

  const summaryParts = createMemo(() => {
    if (!anyEntry()) return null
    return {
      done: `${summaryDot()}${doneCount()}`,
      running: runningCount() > 0 ? `${summaryDot()}${runningCount()}` : null,
      err: errCount() > 0 ? `${summaryDot()}${errCount()}` : null,
      duration: fmtDurationShort(maxElapsed(), false),
    }
  })

  const leftCols = createMemo(() => {
    return visualWidth(openIcon()) + 1 + visualWidth("Sub-Agents") + visualWidth(versionStr())
  })

  const summaryCols = createMemo(() => {
    const p = summaryParts()
    if (!p) return 0
    let w = visualWidth(p.done)
    if (p.running) w += 1 + visualWidth(p.running)
    if (p.err) w += 1 + visualWidth(p.err)
    w += 1 + visualWidth(p.duration)
    return w
  })

  const spacerCols = createMemo(() => {
    if (!anyEntry()) return 0
    return Math.max(1, panelWidth() - leftCols() - 1 - summaryCols())
  })

  /** Available columns for a value in an expanded field row (after indent + label). */
  const valueCols = (label: string) =>
    Math.max(4, panelWidth() - 4 - visualWidth(label + ": "))

  return (
    <box
      border={false}
      paddingTop={0} paddingBottom={0} paddingLeft={0} paddingRight={0}
      flexDirection="column" gap={0}
      ref={boxEl}
      onSizeChange={() => {
        const w = boxEl ? Math.max(20, boxEl.width ?? 0) : 28
        setPanelWidth((prev) => (prev === w ? prev : w))
      }}
    >
      {/* ── header: colored spans (no <Show> inside <text>) ── */}
      <text onMouseUp={() => setOpen((o) => !o)}>
        <span style={{ fg: pal().muted }}>{openIcon()} </span>
        <span style={{ fg: pal().primary }}>Sub-Agents</span>
        <span style={{ fg: pal().border }}>{versionStr()}</span>
        {anyEntry() ? (
          <>
            <span style={{ fg: pal().muted }}>{" ".repeat(spacerCols())}</span>
            <span style={{ fg: pal().success }}>{summaryParts()!.done}</span>
            {runningCount() > 0 && <span style={{ fg: pal().warning }}> {summaryParts()!.running}</span>}
            {errCount() > 0 && <span style={{ fg: pal().error }}> {summaryParts()!.err}</span>}
            <span style={{ fg: pal().muted }}> {summaryParts()!.duration}</span>
          </>
        ) : null}
      </text>

      {/* ── panel body ── */}
      <Show when={open()}>
        <text fg={pal().muted}>{sep()}</text>

        <Show
          when={anyEntry()}
          fallback={
            <text style={{ fg: pal().muted }}>
              {"  "}&gt; No sub-agents yet
            </text>
          }
        >
          <For each={entries()}>
            {(entry) => {
              const isExpanded = () => expanded().has(entry.id)
              const isRunning = entry.status === "running"
              const isError = entry.status === "error"

              const statusDot = "\u25cf"
              const statusColor = isRunning ? pal().warning : isError ? pal().error : pal().success

              const expandIcon = isExpanded() ? "\u25bc" : "\u25b6"
              const timeStr = fmtDurationShort(entry.elapsed, isRunning)
              const timeColor = isRunning ? pal().warning : isError ? pal().error : pal().muted

              const agentWidth = Math.max(6, panelWidth() - 2 - 1 - 1 - 1 - 1 - (timeStr ? visualWidth(timeStr) + 1 : 0))

              return (
                <>
                  {/* entry line */}
                  <text onMouseUp={() => toggleExpand(entry.id)}>
                    {"  "}
                    <span style={{ fg: pal().muted }}>{expandIcon}</span>
                    {" "}
                    <span style={{ fg: statusColor }}>{statusDot}</span>
                    {" "}
                    <span style={{ fg: pal().text }}>{truncate(entry.agent, agentWidth)}</span>
                    <Show when={timeStr}>
                      {" "}
                      <span style={{ fg: timeColor }}>{timeStr}</span>
                    </Show>
                  </text>

                  {/* expanded detail */}
                  <Show when={isExpanded()}>
                    <Show when={entry.prompt}>
                      <text>
                        {"    "}
                        <span style={{ fg: pal().primary }}>prompt: </span>
                        <span style={{ fg: pal().text }}>
                          {truncate(
                            entry.prompt.replace(/\n/g, " ").replace(/\s+/g, " ").trim(),
                            valueCols("prompt")
                          )}
                        </span>
                      </text>
                    </Show>
                    <Show when={entry.model}>
                      <text>
                        {"    "}
                        <span style={{ fg: pal().primary }}>model: </span>
                        <span style={{ fg: pal().muted }}>
                          {truncate(entry.model!, valueCols("model"))}
                        </span>
                      </text>
                    </Show>
                    <Show when={entry.command}>
                      <text>
                        {"    "}
                        <span style={{ fg: pal().primary }}>cmd: </span>
                        <span style={{ fg: pal().muted }}>
                          {truncate(
                            entry.command!.replace(/\n/g, " ").replace(/\s+/g, " ").trim(),
                            valueCols("cmd")
                          )}
                        </span>
                      </text>
                    </Show>
                  </Show>
                </>
              )
            }}
          </For>
        </Show>
      </Show>
    </box>
  )
}

// ===================================================================
// Plugin entry
// ===================================================================

function createSidebarSlot(api: TuiPluginApi): TuiSlotPlugin {
  return {
    order: 60,
    slots: {
      sidebar_content(ctx: TuiSlotContext, input: { session_id: string }): JSX.Element {
        return (
          <SubAgentPanel theme={ctx.theme.current} api={api} />
        )
      },
    },
  }
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  api.slots.register(createSidebarSlot(api))
}

const mod: TuiPluginModule & { id: string } = {
  id: "opencode-subagent-monitor",
  tui,
}

export default mod
