import type { SessionRecord } from "./types"

export const KV_PREFIX = "subagent_magazine"
export const SESSION_DATA_KEY = `${KV_PREFIX}.session_data`

/** Minimal KV surface used by the magazine's persistence layer. */
export interface KVApi {
  get(key: string, fallback?: unknown): unknown
  set(key: string, value: unknown): void
  /**
   * Optional atomic read-modify-write. When the host exposes it (V2), the
   * updater runs under the host storage lock against the latest on-disk value,
   * which is what makes concurrent TUI instances safe: no instance can
   * overwrite another one's fresh writes with a stale in-memory snapshot.
   */
  update?(key: string, updater: (current: unknown) => unknown): void | Promise<void>
}

/** Setting keys shared by V1/V2 (values are raw strings in KV). */
export const SETTING_KEYS = {
  lang: `${KV_PREFIX}.lang`,
  maxEntries: `${KV_PREFIX}.max_entries`,
  order: `${KV_PREFIX}.order`,
  scrollMode: `${KV_PREFIX}.scroll_mode`,
  open: `${KV_PREFIX}.open`,
  ttlDays: `${KV_PREFIX}.ttl_days`,
  border: `${KV_PREFIX}.border`,
  showEntryCost: `${KV_PREFIX}.show_entry_cost`,
  showEntryTime: `${KV_PREFIX}.show_entry_time`,
  showEntryTokens: `${KV_PREFIX}.show_entry_tokens`,
  timeFormat: `${KV_PREFIX}.time_format`,
  showOrigin: `${KV_PREFIX}.show_origin`,
  dbSync: `${KV_PREFIX}.db_sync`,
} as const

export function loadSessionData(kv: KVApi): Record<string, SessionRecord> {
  try {
    const raw = kv.get(SESSION_DATA_KEY, "{}")
    return JSON.parse(String(raw))
  } catch { return {} }
}

/**
 * Atomic read-merge-write of the session store.
 *
 * `mutator` receives the latest persisted map (read under the host lock when
 * `kv.update` is available) and may mutate it freely; the result is written
 * back. Every writer must go through here: writing a whole in-memory snapshot
 * directly would silently drop entries created by the other TUIs.
 */
export function updateSessionData(
  kv: KVApi,
  mutator: (data: Record<string, SessionRecord>) => void,
): void | Promise<void> {
  try {
    if (typeof kv.update === "function") {
      return kv.update(SESSION_DATA_KEY, (raw) => {
        const data = parseSessionData(raw)
        mutator(data)
        return JSON.stringify(data)
      })
    }
    // Fallback (V1 hosts without atomic update): read-modify-write. The window
    // is small and the mutation is merged against the value we just read.
    const data = loadSessionData(kv)
    mutator(data)
    kv.set(SESSION_DATA_KEY, JSON.stringify(data))
  } catch {}
}

function parseSessionData(raw: unknown): Record<string, SessionRecord> {
  try { return JSON.parse(String(raw ?? "{}")) } catch { return {} }
}

export function readTTLDays(kv: KVApi): number {
  const ttlDaysRaw = parseInt(String(kv.get(SETTING_KEYS.ttlDays, "3")), 10)
  return Number.isNaN(ttlDaysRaw) ? 3 : ttlDaysRaw
}
