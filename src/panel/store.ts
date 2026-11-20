import { createSignal } from "solid-js"
import type { SubEntry } from "../core/types"

/** 模块级缓存：各 session 的 entry 状态独立存储，不随当前视图切换而清除。 */
export const globalEntryCache = new Map<string, Map<string, SubEntry>>()

/** 模块级刷新信号：外部（如斜杠命令）触发清除后 +1，组件 scan 依赖它以重扫。 */
export const [clearTick, setClearTick] = createSignal(0)

export type TwinEntry = SubEntry & { ownerSid?: string; guessedSid?: boolean }
export const entryTwins = new Map<string, Set<string>>()
export const rememberEntryTwin = (id?: string, s?: string, owner?: string) => { const b = s && s !== owner ? "sub:" + s : ""; if (!id || !b || id === b) return; entryTwins.set(id, (entryTwins.get(id) ?? new Set()).add(b)); entryTwins.set(b, (entryTwins.get(b) ?? new Set()).add(id)) }
export const expandEntryTwins = (ids?: Iterable<string>) => { const out = new Set<string>(ids ?? []), q = [...out]; for (let i = 0; i < q.length; i++) for (const t of entryTwins.get(q[i]) ?? []) if (!out.has(t)) { out.add(t); q.push(t) } return out }
export const collectClearedEntryIds = (sid: string, ...ls: (Iterable<TwinEntry> | undefined)[]) => { const es = new Set<string>(), cs = new Set<string>(); for (const l of ls) for (const e of l ?? []) if (e?.id) { es.add(e.id); cs.add(e.id); if (!e.guessedSid && e.sessionId && e.sessionId !== sid && e.sessionId !== e.ownerSid) { rememberEntryTwin(e.id, e.sessionId, e.ownerSid); cs.add("sub:" + e.sessionId) } } return { entryIds: [...es], clearedIds: [...expandEntryTwins(cs)] } }
