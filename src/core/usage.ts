export interface TodoStats {
  total: number
  done: number
}

/**
 * Data-source abstraction for per-session usage reads.
 * V1 and V2 provide their own implementations backed by their respective
 * client APIs; the state machine consumes only this surface.
 */
export interface UsageReader {
  readSessionTokens(sid: string): number | undefined
  readSessionCost(sid: string): number | undefined
  readSessionModel(sid: string): string | undefined
  readSessionTodo(sid: string): TodoStats | undefined
}
