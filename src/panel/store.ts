import { createSignal } from "solid-js"
import type { SubEntry } from "../core/types"

/** 模块级缓存：各 session 的 entry 状态独立存储，不随当前视图切换而清除。 */
export const globalEntryCache = new Map<string, Map<string, SubEntry>>()

/** Reload only the panel that was cleared; other sessions keep their view state. */
export const [clearNotice, setClearNotice] = createSignal<{ sessionId: string; revision: number }>()
export function notifySessionCleared(sessionId: string) {
  setClearNotice((previous) => ({ sessionId, revision: (previous?.revision ?? 0) + 1 }))
}
