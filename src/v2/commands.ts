import type { Context, KeymapCommand } from "./types"
import type { PanelApi } from "../panel/panel-api"
import type { Lang, SharedSignals, SubStatus } from "../core/types"
import { KV_PREFIX, SETTING_KEYS, loadSessionData, saveSessionData, readTTLDays } from "../core/kv"
import { PLUGIN_VERSION } from "../_version"
import { LANG_META, createT } from "../i18n"
import { globalEntryCache, setClearTick } from "../panel/store"

/** V2 命令（对齐 V1 的 9 个斜杠命令——promise 式对话框）。 */
export function makeCommands(context: Context, api: PanelApi, signals: SharedSignals): KeymapCommand[] {
  const t = createT(() => signals.lang())
  const kv = api.kv
  const clampMax = (n: number) => Math.max(1, Math.min(50, n))

  const resolveParent = (sid: string): { parentSid: string; isChild: boolean } => {
    try {
      const session = api.session.get(sid) as any
      const parentID = session?.parentID as string | undefined
      if (parentID) return { parentSid: parentID, isChild: true }
    } catch {}
    return { parentSid: sid, isChild: false }
  }

  return [
    {
      id: "opencode-subagent-magazine.subagent.lang",
      title: "SubAgent Magazine: Language",
      description: "Switch display language (中文 / English / 日本語 / 한국어)",
      slash: { name: "subagent-lang" },
      palette: true,
      run: async () => {
        const lang = await context.ui.dialog.select<Lang>({
          title: "Language / 语言",
          options: LANG_META.map((m) => ({ title: m.label, value: m.code })),
        })
        if (!lang) return
        signals.setLang(lang)
        kv.set(SETTING_KEYS.lang, lang)
        api.ui.toast("Language: " + (LANG_META.find((m) => m.code === lang)?.label ?? lang))
      },
    },
    {
      id: "opencode-subagent-magazine.subagent.order",
      title: "SubAgent Magazine: Sort Order",
      description: "Set sub-agent entry sort order (desc / asc)",
      slash: { name: "subagent-order" },
      palette: true,
      run: async () => {
        const order = await context.ui.dialog.select<"desc" | "asc">({
          title: "Sort Order / 排序方式",
          options: [
            { title: t("order.desc"), value: "desc" },
            { title: t("order.asc"), value: "asc" },
          ],
        })
        if (!order) return
        signals.setSortOrder(order)
        kv.set(SETTING_KEYS.order, order)
        api.ui.toast(order === "desc" ? t("order.desc") : t("order.asc"))
      },
    },
    {
      id: "opencode-subagent-magazine.subagent.scroll",
      title: "SubAgent Magazine: Scroll Mode",
      description: "Set scroll mode (wheel / click)",
      slash: { name: "subagent-scroll" },
      palette: true,
      run: async () => {
        const mode = await context.ui.dialog.select<"wheel" | "click">({
          title: "Scroll Mode / 滚动模式",
          options: [
            { title: t("scroll.wheel"), value: "wheel" },
            { title: t("scroll.click"), value: "click" },
          ],
        })
        if (!mode) return
        signals.setScrollMode(mode)
        kv.set(SETTING_KEYS.scrollMode, mode)
        api.ui.toast(mode === "wheel" ? t("scroll.wheel") : t("scroll.click"))
      },
    },
    {
      id: "opencode-subagent-magazine.subagent.max",
      title: "SubAgent Magazine: Max Entries",
      description: "Set max visible sub-agent entries in sidebar",
      slash: { name: "subagent-max" },
      palette: true,
      run: async () => {
        const val = await context.ui.dialog.prompt({
          title: "Max Visible Entries",
          message: "Number of entries to show in the sidebar (1–50)",
          placeholder: String(signals.maxEntries()),
        })
        if (val === undefined) return
        const n = clampMax(parseInt(val, 10) || 10)
        signals.setMaxEntries(n)
        kv.set(SETTING_KEYS.maxEntries, n)
        api.ui.toast(`Max entries: ${n}`)
      },
    },
    {
      id: "opencode-subagent-magazine.subagent.version",
      title: "SubAgent Magazine: Version",
      description: "Show plugin version",
      slash: { name: "subagent-version" },
      palette: true,
      run: () => {
        api.ui.toast(`opencode-subagent-magazine v${PLUGIN_VERSION}`)
      },
    },
    {
      id: "opencode-subagent-magazine.subagent.session",
      title: "SubAgent Magazine: Session",
      description: "Show current session ID",
      slash: { name: "subagent-session" },
      palette: true,
      run: () => {
        api.ui.toast(`Session: ${signals.sessionId}`)
      },
    },
    {
      id: "opencode-subagent-magazine.subagent.clear-running",
      title: "SubAgent Magazine: Clear Running",
      description: "Mark all running sub-agent entries as done (for stuck/zombie entries)",
      slash: { name: "subagent-clear-running" },
      palette: true,
      run: () => {
        const sid = signals.sessionId
        const entries = globalEntryCache.get(sid)
        if (!entries || entries.size === 0) {
          api.ui.toast(signals.lang() === "zh" ? "暂无子代理条目" : "No sub-agent entries found")
          return
        }
        let count = 0
        for (const [, entry] of entries) {
          if (entry.status === "running" || entry.status === "cancel_requested") {
            entry.status = "done" as SubStatus
            entry.endedAt = Date.now()
            count++
          }
        }
        if (count > 0) {
          try {
            const data = loadSessionData(kv)
            const { parentSid, isChild } = resolveParent(sid)
            if (isChild) {
              if (!data[parentSid]) data[parentSid] = { ts: Date.now(), entries: [], scroll: 0, expanded: "", children: {} }
              if (!data[parentSid].children) data[parentSid].children = {}
              if (!data[parentSid].children[sid]) data[parentSid].children[sid] = { scroll: 0, expanded: "", entries: [] }
              data[parentSid].children[sid] = { ...data[parentSid].children[sid], entries: [...entries.values()] }
            } else {
              data[sid] = {
                ts: Date.now(),
                entries: [...entries.values()],
                scroll: data[sid]?.scroll ?? 0,
                expanded: data[sid]?.expanded ?? "",
                children: data[sid]?.children ?? {},
              }
            }
            saveSessionData(kv, data)
          } catch {}
          api.ui.toast(signals.lang() === "zh"
            ? `已标记 ${count} 个运行中的条目为完成`
            : `Marked ${count} running entries as done`)
        } else {
          api.ui.toast(signals.lang() === "zh" ? "没有需要清理的运行中条目" : "No running entries to clear")
        }
      },
    },
    {
      id: "opencode-subagent-magazine.subagent.ttl",
      title: "SubAgent Magazine: TTL",
      description: "Set session data retention period (days before auto-cleanup)",
      slash: { name: "subagent-ttl" },
      palette: true,
      run: async () => {
        const curDays = readTTLDays(kv)
        const curLabel = curDays === 0 ? t("ttl.unlimited") : `${curDays}d`
        const days = await context.ui.dialog.select<number>({
          title: `${t("ttl.label")}  (${curLabel})`,
          options: [
            { title: t("ttl.3d"), value: 3 },
            { title: t("ttl.7d"), value: 7 },
            { title: t("ttl.14d"), value: 14 },
            { title: t("ttl.30d"), value: 30 },
            { title: t("ttl.unlimited"), value: 0 },
          ],
        })
        if (days === undefined) return
        kv.set(SETTING_KEYS.ttlDays, String(days))
        api.ui.toast(days === 0 ? t("ttl.toast_unlimited") : t("ttl.toast", { n: days }))
      },
    },
    {
      id: "opencode-subagent-magazine.subagent.clear-entries",
      title: "SubAgent Magazine: Clear Entries",
      description: "Delete all sub-agent records for the current session (cannot be undone)",
      slash: { name: "subagent-clear-entries" },
      palette: true,
      run: async () => {
        const sid = signals.sessionId
        const sessionObj = api.session.get(sid)
        const parentID = (sessionObj as any)?.parentID as string | undefined
        const cached = globalEntryCache.get(sid)
        let runningCount = 0
        if (cached) {
          for (const [, e] of cached) { if (e.status === "running") runningCount++ }
        }
        const msg = runningCount > 0 ? t("clear.prompt_running", { n: runningCount }) : t("clear.prompt")
        const choice = await context.ui.dialog.select<"yes" | "no">({
          title: t("clear.title"),
          options: [
            { title: t("clear.title"), value: "yes" },
            { title: t("cancel.label"), value: "no" },
          ],
        })
        if (choice !== "yes") return
        try {
          const data = loadSessionData(kv)
          let count = 0
          if (parentID) {
            if (data[parentID]?.children?.[sid]) {
              const child = data[parentID].children[sid]
              const ids = child.entries?.map((e) => e.id) ?? []
              count = ids.length
              child.entries = []
              child.scroll = 0
              child.expanded = ""
              child.clearedIds = [...new Set([...(child.clearedIds ?? []), ...ids])]
            }
          } else {
            count = data[sid]?.entries?.length ?? 0
            if (data[sid]) {
              const ids = data[sid].entries?.map((e) => e.id) ?? []
              data[sid].entries = []
              data[sid].scroll = 0
              data[sid].expanded = ""
              data[sid].clearedIds = [...new Set([...(data[sid].clearedIds ?? []), ...ids])]
            }
          }
          saveSessionData(kv, data)
          globalEntryCache.delete(sid)
          setClearTick((v) => v + 1)
          api.ui.toast(t("clear.done", { n: count }))
        } catch {}
      },
    },
  ]
}

export { KV_PREFIX }
