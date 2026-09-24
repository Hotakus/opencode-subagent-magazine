import type { KVApi } from "../core/kv"
import type { UsageReader, TodoStats } from "../core/usage"
import type { Lang, SortOrder, ScrollMode } from "../core/types"

/** Minimal session shape the panel reads from the host SDK. */
export interface SessionLike {
  id?: string
  parentID?: string
  agent?: string
  cost?: number
}

/** Spawned child session summary (V2 reads it from the local database). */
export interface ChildSessionLike {
  id: string
  agent?: string
  title?: string
  model?: string
  cost?: number
  tokens?: number
  timeCreated?: number
  timeIdle?: number
  idleOutcome?: string
  /** Still running: last message is newer than time_idle (resume keeps the old value). */
  active?: boolean
}

export interface SessionStatusLike {
  type: string
}

/**
 * Standardized panel events. Adapter layers (V1/V2) translate host events
 * into these shapes so the panel component never touches host APIs directly.
 */
export type PanelEventType = "part.updated" | "message.updated" | "session.idle" | "session.error"
export type PanelEventScope = "session" | "global"

export interface PanelEvent {
  type: PanelEventType
  /** Global V2 events need explicit session ownership checks. */
  scope?: PanelEventScope
  /** part payload for part.updated; session properties for idle/error. */
  payload?: Record<string, unknown>
}

export interface ToastOptions {
  variant?: "success" | "warning" | "error"
  title?: string
  duration?: number
}

/**
 * The full surface the SubAgentPanel component consumes.
 * V1 and V2 each implement this against their host SDK; the panel is agnostic.
 * Theme is slot-scoped in both hosts, so it is passed as a panel prop,
 * not part of the API.
 */
export interface PanelApi {
  kv: KVApi
  usage: UsageReader
  session: {
    get(sid: string): SessionLike | undefined
    status(sid: string): SessionStatusLike | undefined
    /** Raw message list for a session (scan / error extraction). */
    messages(sid: string): unknown[] | undefined
    /** Raw parts of a message (scan). */
    part(messageID: string): unknown[] | undefined
    /** Optional host-side fallback: map a subagent tool call to its child session
     *  when live events/history lack the link (V2 reads the local database). */
    resolveChild?(input: {
      parentId: string
      callId?: string
      agent?: string
      startedAt?: number
    }): string | undefined
    /** Optional host-side listing of spawned child sessions. */
    listChildren?(parentId: string): ChildSessionLike[] | undefined
  }
  event: {
    on(type: PanelEventType, cb: (e: PanelEvent) => void): () => void
  }
  client: {
    abort(input: { sessionID: string }): Promise<void>
  }
  route: {
    navigateSession(sessionID: string): void
  }
  ui: {
    toast(message: string, opts?: ToastOptions): void
  }
  settings: {
    lang: () => Lang
    maxEntries: () => number
    sortOrder: () => SortOrder
    scrollMode: () => ScrollMode
  }
}

export type { TodoStats }
