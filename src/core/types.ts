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
  /** 来源：工具调用条目 / 衍生会话条目（spawn）。 */
  origin?: "tool" | "sub"
  /** 工具输入带 background/run_in_background（后台衍生会话）。 */
  background?: boolean
}

export type Lang = LangCode
export type SortOrder = "desc" | "asc"
export type ScrollMode = "wheel" | "click"
/** How elapsed time is rendered in the sidebar (see TIME_FORMAT_SAMPLES). */
export type TimeFormat = "decimal" | "short" | "clock" | "compact" | "seconds"

/** OpenCode built-in tool names that spawn sub-agents or delegate tasks. */
export const SUBAGENT_TOOLS = new Set(["task", "subagent", "delegate", "call_omo_agent"])

/** 工具输入是否声明后台执行（V1/V2 两种字段名）。 */
export function isBackgroundInput(input: unknown): boolean {
  if (!input || typeof input !== "object") return false
  const i = input as Record<string, unknown>
  return i.background === true || i.run_in_background === true
}

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
  borderVisible: () => boolean
  setBorderVisible: (v: boolean) => void
  showEntryCost: () => boolean
  setShowEntryCost: (v: boolean) => void
  showEntryTime: () => boolean
  setShowEntryTime: (v: boolean) => void
  showEntryTokens: () => boolean
  setShowEntryTokens: (v: boolean) => void
  timeFormat: () => TimeFormat
  setTimeFormat: (f: TimeFormat) => void
  dbSync: () => boolean
  setDbSync: (v: boolean) => void
  sessionId: string
}
