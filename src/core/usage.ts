export interface TodoStats {
  total: number
  done: number
}

/** 一轮调用的用量（按调用分行模式，见 /subagent-split）。 */
export interface CallUsage {
  /** 本轮之后第一条 idle 的时间；仍在运行时为 undefined。 */
  endedAt?: number
  /** idle 的结果：succeeded / interrupted / failed。 */
  outcome?: string
  /** 本轮最后一条有输出的 assistant 消息的上下文规模（同 readSessionTokens 口径）。 */
  tokens?: number
  /** 本轮 assistant 消息的费用之和。 */
  cost?: number
  model?: string
}

/** 子会话消息的精简形状，只保留计算一轮调用所需的字段。 */
export interface WindowMessage {
  type: string
  at: number
  cost?: number
  /** 有输出的 assistant 消息的上下文规模。 */
  tokens?: number
  model?: string
  outcome?: string
}

/** 父会话工具调用时间与子会话 user 消息时间之间允许的偏差。 */
export const CALL_WINDOW_TOLERANCE_MS = 10_000

/**
 * 续接同一子会话的调用（subagent 工具带 sessionID）会在子会话里
 * 开启新的一轮：user 消息 → assistant 消息 → idle。按调用开始时间
 * 找到最近的那条 user 消息，统计到其后第一条 idle 为止。
 *
 * 找不到对应的 user 消息（本轮尚未开始）时返回 undefined。
 */
export function callWindowUsage(messages: readonly WindowMessage[], startedAt: number): CallUsage | undefined {
  let start = -1
  let gap = Number.POSITIVE_INFINITY
  messages.forEach((m, i) => {
    if (m.type !== "user") return
    const d = Math.abs(m.at - startedAt)
    if (d <= CALL_WINDOW_TOLERANCE_MS && d < gap) {
      gap = d
      start = i
    }
  })
  if (start < 0) return undefined

  const usage: CallUsage = {}
  let cost = 0
  let sawAssistant = false
  for (let i = start + 1; i < messages.length; i++) {
    const m = messages[i]
    if (m.type === "idle") {
      usage.endedAt = m.at
      usage.outcome = m.outcome
      break
    }
    if (m.type !== "assistant") continue
    sawAssistant = true
    cost += m.cost ?? 0
    if (m.tokens !== undefined) usage.tokens = m.tokens
    if (m.model) usage.model = m.model
  }
  if (sawAssistant) usage.cost = cost
  return usage
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
  /** Optional: usage of the round started by one call (per-call rows). */
  readCallUsage?(sid: string, startedAt: number): CallUsage | undefined
}
