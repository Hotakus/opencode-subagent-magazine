import type { LangCode } from "../i18n"

export type SubStatus = "running" | "done" | "error" | "cancel_requested" | "cancelled"

export interface SubEntry {
  id: string
  title: string
  agent: string
  prompt: string
  error?: string
  tokens?: number
  cost?: number
  status: SubStatus
  sessionId?: string
  startedAt: number
  endedAt?: number
  model?: string
  todoTotal?: number
  todoDone?: number
  cancelRequestedAt?: number
  abortAccepted?: boolean
  cancelReason?: "manual"
}

export type Lang = LangCode
export type SortOrder = "desc" | "asc"
export type ScrollMode = "wheel" | "click"

/** OpenCode built-in tool names that spawn sub-agents or delegate tasks. */
export const SUBAGENT_TOOLS = new Set(["task", "delegate", "call_omo_agent"])

export interface ChildRecord {
  scroll: number
  expanded: string
  entries: SubEntry[]
  clearedIds?: string[]
}

export interface SessionRecord {
  ts: number
  entries: SubEntry[]
  scroll: number
  expanded: string
  children: Record<string, ChildRecord>
  clearedIds?: string[]
}

export interface SharedSignals {
  lang: () => Lang
  setLang: (l: Lang) => void
  maxEntries: () => number
  setMaxEntries: (n: number) => void
  sortOrder: () => SortOrder
  setSortOrder: (o: SortOrder) => void
  scrollMode: () => ScrollMode
  setScrollMode: (m: ScrollMode) => void
  sessionId: string
}
