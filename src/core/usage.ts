export interface TodoStats {
  total: number
  done: number
}

/** 已加载 assistant 消息的 token 求和：库里没有这条会话时的累计值（只加载了部分消息时偏小）。V2 消息用 type，V1 用 role。 */
export function sumAssistantTokens(msgs: unknown): number | undefined {
  if (!Array.isArray(msgs)) return undefined
  let sum = 0
  for (const m of msgs) {
    if (m?.type !== "assistant" && m?.role !== "assistant") continue
    const t = m.tokens
    sum += (Number(t?.input) || 0) + (Number(t?.output) || 0) + (Number(t?.reasoning) || 0) + (Number(t?.cache?.read) || 0) + (Number(t?.cache?.write) || 0)
  }
  return sum > 0 ? sum : undefined
}

/**
 * Data-source abstraction for per-session usage reads.
 * V1 and V2 provide their own implementations backed by their respective
 * client APIs; the state machine consumes only this surface.
 */
export interface UsageReader {
  readSessionTokens(sid: string): number | undefined
  readSessionCost(sid: string): number | undefined
  readSessionTotalTokens(sid: string): number | undefined
  readSessionModel(sid: string): string | undefined
  readSessionTodo(sid: string): TodoStats | undefined
}
