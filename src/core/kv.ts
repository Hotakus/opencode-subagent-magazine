import type { SessionRecord } from "./types"

export const KV_PREFIX = "subagent_magazine"
export const SESSION_DATA_KEY = `${KV_PREFIX}.session_data`

/** Minimal KV surface used by the magazine's persistence layer. */
export interface KVApi {
  get(key: string, fallback?: unknown): unknown
  set(key: string, value: unknown): void
}

/** Setting keys shared by V1/V2 (values are raw strings in KV). */
export const SETTING_KEYS = {
  lang: `${KV_PREFIX}.lang`,
  maxEntries: `${KV_PREFIX}.max_entries`,
  order: `${KV_PREFIX}.order`,
  scrollMode: `${KV_PREFIX}.scroll_mode`,
  open: `${KV_PREFIX}.open`,
  ttlDays: `${KV_PREFIX}.ttl_days`,
} as const

export function loadSessionData(kv: KVApi): Record<string, SessionRecord> {
  try {
    const raw = kv.get(SESSION_DATA_KEY, "{}")
    return JSON.parse(String(raw))
  } catch { return {} }
}

export function saveSessionData(kv: KVApi, data: Record<string, SessionRecord>) {
  try { kv.set(SESSION_DATA_KEY, JSON.stringify(data)) } catch {}
}

export function readTTLDays(kv: KVApi): number {
  const ttlDaysRaw = parseInt(String(kv.get(SETTING_KEYS.ttlDays, "3")), 10)
  return Number.isNaN(ttlDaysRaw) ? 3 : ttlDaysRaw
}
