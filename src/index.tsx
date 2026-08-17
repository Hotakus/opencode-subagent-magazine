/** @jsxImportSource @opentui/solid */

import type { JSX } from "@opentui/solid"
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiSlotContext,
  TuiSlotPlugin,
  TuiPluginModule,
} from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { PLUGIN_VERSION } from "./_version"
import { LANG_META, createT, detectLang } from "./i18n"
import type { Lang, SortOrder, ScrollMode, SubStatus, SharedSignals } from "./core/types"
import { KV_PREFIX } from "./core/kv"
import type { PanelApi } from "./panel/panel-api"
import { SubAgentPanel } from "./panel/SubAgentPanel"
import { globalEntryCache, setClearTick } from "./panel/store"

// Plugin entry
// ===================================================================

function createSidebarSlot(api: TuiPluginApi, panelApi: PanelApi, sig: SharedSignals): TuiSlotPlugin {
  return {
    order: 60,
    slots: {
      sidebar_content(ctx: TuiSlotContext, input: { session_id: string }): JSX.Element {
        sig.sessionId = input.session_id
        return (
          <SubAgentPanel
            api={panelApi}
            theme={ctx.theme.current as Record<string, unknown>}
            lang={sig.lang}
            maxEntries={sig.maxEntries}
            sortOrder={sig.sortOrder}
            scrollMode={sig.scrollMode}
            sessionId={input.session_id}
          />
        )
      },
    },
  }
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  // ── language ──
  const stored = String(api.kv.get(`${KV_PREFIX}.lang`, ""))
  const initialLang: Lang =
    LANG_META.some((m) => m.code === stored) ? (stored as Lang) : detectLang()
  const [lang, setLang] = createSignal<Lang>(initialLang)
  const [maxEntries, setMaxEntries] = createSignal(
    parseInt(String(api.kv.get(`${KV_PREFIX}.max_entries`, "10")), 10) || 10
  )
  const [sortOrder, setSortOrder] = createSignal<SortOrder>(
    String(api.kv.get(`${KV_PREFIX}.order`, "desc")) === "asc" ? "asc" : "desc"
  )
  const [scrollMode, setScrollMode] = createSignal<ScrollMode>(
    String(api.kv.get(`${KV_PREFIX}.scroll_mode`, "wheel")) === "click" ? "click" : "wheel"
  )

  const signals: SharedSignals = { lang, setLang, maxEntries, setMaxEntries, sortOrder, setSortOrder, scrollMode, setScrollMode, sessionId: "" }

  // ── V1 PanelApi adapter: wraps the V1 host API into the shared panel contract ──
  const v1Api: PanelApi = {
    kv: api.kv as any,
    usage: {
      readSessionTokens: (sid: string): number | undefined => {
        if (!sid) return undefined
        try {
          const msgs = api.state.session.messages(sid)
          if (msgs) {
            for (let i = (msgs as any[]).length - 1; i >= 0; i--) {
              const m = (msgs as any[])[i]
              if (m.role !== "assistant") continue
              const t = m.tokens
              if (!t || !(Number(t.output) > 0)) continue
              const ctx =
                (Number(t.input) || 0) +
                (Number(t.output) || 0) +
                (Number(t.reasoning) || 0) +
                (Number(t.cache?.read) || 0) +
                (Number(t.cache?.write) || 0)
              if (ctx > 0) return ctx
            }
          }
          return undefined
        } catch {
          return undefined
        }
      },
      readSessionCost: (sid: string): number | undefined => {
        if (!sid) return undefined
        try {
          const session = api.state.session.get(sid)
          if (session?.cost != null && session.cost > 0) return session.cost
          const msgs = api.state.session.messages(sid)
          if (!msgs) return undefined
          let total = 0
          for (const m of msgs as any[]) {
            if (m.role === "assistant" && typeof m.cost === "number") total += m.cost
          }
          return total > 0 ? total : undefined
        } catch {
          return undefined
        }
      },
      readSessionModel: (sid: string): string | undefined => {
        if (!sid) return undefined
        try {
          const msgs = api.state.session.messages(sid)
          if (msgs) {
            for (let i = (msgs as any[]).length - 1; i >= 0; i--) {
              const m = (msgs as any[])[i]
              if (m.role === "assistant" && m.modelID) return String(m.modelID)
            }
          }
          return undefined
        } catch {
          return undefined
        }
      },
      readSessionTodo: (sid: string): { total: number; done: number } | undefined => {
        if (!sid) return undefined
        try {
          const todos = api.state.session.todo(sid)
          if (!todos || todos.length === 0) return undefined
          let done = 0
          for (const t of todos) {
            if (t.status === "completed" || t.status === "cancelled") done++
          }
          return { total: todos.length, done }
        } catch {
          return undefined
        }
      },
    },
    session: {
      get: (sid) => { try { return api.state.session.get(sid) as any } catch { return undefined } },
      status: (sid) => { try { return api.state.session.status(sid) as any } catch { return undefined } },
      messages: (sid) => { try { return api.state.session.messages(sid) as any[] } catch { return undefined } },
      part: (messageID) => { try { return api.state.part(messageID) as any[] } catch { return undefined } },
    },
    event: {
      on: (type, cb) => {
        switch (type) {
          case "part.updated":
            return api.event.on("message.part.updated", (e) =>
              cb({ type, payload: { part: (e as any).properties?.part } }))
          case "message.updated":
            return api.event.on("message.updated", () => cb({ type }))
          case "session.idle":
            return api.event.on("session.idle", (e) => cb({ type, payload: (e as any).properties }))
          case "session.error":
            return api.event.on("session.error", (e) => cb({ type, payload: (e as any).properties }))
        }
      },
    },
    client: {
      abort: (input) => api.client.session.abort(input).then(() => {}),
    },
    route: {
      navigateSession: (sessionID) => api.route.navigate("session", { sessionID }),
    },
    ui: {
      toast: (message, opts) => api.ui.toast({ ...opts, message } as any),
    },
    settings: {
      lang: () => lang(),
      maxEntries: () => maxEntries(),
      sortOrder: () => sortOrder(),
      scrollMode: () => scrollMode(),
    },
  }

  api.slots.register(createSidebarSlot(api, v1Api, signals))

  // ── slash command: /subagent-lang ──
  api.command?.register(() => [
    {
      title: "SubAgent Magazine: Language",
      value: "subagent-lang",
      description: "Switch display language (中文 / English)",
      slash: { name: "subagent-lang" },
      onSelect: (dialog) => {
        dialog?.replace(() => (
          <api.ui.DialogSelect
            title="Language / 语言"
            options={LANG_META.map((m) => ({ title: m.label, value: m.code }))}
            onSelect={(opt) => {
              const l = opt.value as Lang
              setLang(l)
              api.kv.set(`${KV_PREFIX}.lang`, l)
              api.ui.toast({
                message: "Language: " + (LANG_META.find((m) => m.code === l)?.label ?? l),
              })
              dialog?.clear()
            }}
          />
        ))
      },
    },
    {
      title: "SubAgent Magazine: Sort Order",
      value: "subagent-order",
      description: "Set sub-agent entry sort order (desc / asc)",
      slash: { name: "subagent-order" },
      onSelect: (dialog) => {
        const t = createT(() => lang())
        dialog?.replace(() => (
          <api.ui.DialogSelect
            title="Sort Order / 排序方式"
            options={[
              { title: t("order.desc"), value: "desc" },
              { title: t("order.asc"), value: "asc" },
            ]}
            onSelect={(opt) => {
              const o = opt.value as SortOrder
              setSortOrder(o)
              api.kv.set(`${KV_PREFIX}.order`, o)
              api.ui.toast({
                message: o === "desc" ? t("order.desc") : t("order.asc"),
              })
              dialog?.clear()
            }}
          />
        ))
      },
    },
    {
      title: "SubAgent Magazine: Scroll Mode",
      value: "subagent-scroll",
      description: "Set scroll mode (wheel / click)",
      slash: { name: "subagent-scroll" },
      onSelect: (dialog) => {
        const t = createT(() => lang())
        dialog?.replace(() => (
          <api.ui.DialogSelect
            title="Scroll Mode / 滚动模式"
            options={[
              { title: t("scroll.wheel"), value: "wheel" },
              { title: t("scroll.click"), value: "click" },
            ]}
            onSelect={(opt) => {
              const m = opt.value as ScrollMode
              setScrollMode(m)
              api.kv.set(`${KV_PREFIX}.scroll_mode`, m)
              api.ui.toast({
                message: m === "wheel" ? t("scroll.wheel") : t("scroll.click"),
              })
              dialog?.clear()
            }}
          />
        ))
      },
    },
    {
      title: "SubAgent Magazine: Max Entries",
      value: "subagent-max",
      description: "Set max visible sub-agent entries in sidebar",
      slash: { name: "subagent-max" },
      onSelect: (dialog) => {
        dialog?.replace(() => (
          <api.ui.DialogPrompt
            title="Max Visible Entries"
            description={() => (
              <text>Number of entries to show in the sidebar (1–50)</text>
            )}
            value={String(maxEntries())}
            onConfirm={(val) => {
              const n = Math.max(1, Math.min(50, parseInt(val, 10) || 10))
              setMaxEntries(n)
              api.kv.set(`${KV_PREFIX}.max_entries`, n)
              api.ui.toast({ message: `Max entries: ${n}` })
              dialog?.clear()
            }}
          />
        ))
      },
    },
    {
      title: "SubAgent Magazine: Version",
      value: "subagent-version",
      description: "Show plugin version",
      slash: { name: "subagent-version" },
      onSelect: (dialog) => {
        api.ui.toast({ message: `opencode-subagent-magazine v${PLUGIN_VERSION}` })
        dialog?.clear()
      },
    },
    {
      title: "SubAgent Magazine: Session",
      value: "subagent-session",
      description: "Show current session ID",
      slash: { name: "subagent-session" },
      onSelect: (dialog) => {
        api.ui.toast({ message: `Session: ${signals.sessionId}` })
        dialog?.clear()
      },
    },
    {
      title: "SubAgent Magazine: Clear Running",
      value: "subagent-clear-running",
      description: "Mark all running sub-agent entries as done (for stuck/zombie entries)",
      slash: { name: "subagent-clear-running" },
      onSelect: (dialog) => {
        const sid = signals.sessionId
        const entries = globalEntryCache.get(sid)
        if (!entries || entries.size === 0) {
          const msg = signals.lang() === "zh" ? "暂无子代理条目" : "No sub-agent entries found"
          api.ui.toast({ message: msg })
          dialog?.clear()
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
          // 立即写 KV
          try {
            const data = JSON.parse(String(api.kv.get(`${KV_PREFIX}.session_data`, "{}")))
            const sessionObj = api.state.session.get(sid)
            const parentID = (sessionObj as any)?.parentID as string | undefined
            if (parentID) {
              if (!data[parentID]) data[parentID] = { ts: Date.now(), entries: [], scroll: 0, expanded: "", children: {} }
              if (!data[parentID].children) data[parentID].children = {}
              if (!data[parentID].children[sid]) data[parentID].children[sid] = { scroll: 0, expanded: "", entries: [] }
              data[parentID].children[sid] = { ...data[parentID].children[sid], entries: [...entries.values()] }
            } else {
              data[sid] = {
                ts: Date.now(),
                entries: [...entries.values()],
                scroll: data[sid]?.scroll ?? 0,
                expanded: data[sid]?.expanded ?? "",
                children: data[sid]?.children ?? {},
              }
            }
            api.kv.set(`${KV_PREFIX}.session_data`, JSON.stringify(data))
          } catch {}
          const msg = signals.lang() === "zh"
            ? `已标记 ${count} 个运行中的条目为完成`
            : `Marked ${count} running entries as done`
          api.ui.toast({ message: msg })
        } else {
          const msg = signals.lang() === "zh"
            ? "没有需要清理的运行中条目"
            : "No running entries to clear"
          api.ui.toast({ message: msg })
        }
        dialog?.clear()
      },
    },
    {
      title: "SubAgent Magazine: TTL",
      value: "subagent-ttl",
      description: "Set session data retention period (days before auto-cleanup)",
      slash: { name: "subagent-ttl" },
      onSelect: (dialog) => {
        const t = createT(() => signals.lang())
        const curRaw = parseInt(String(api.kv.get(`${KV_PREFIX}.ttl_days`, "3")), 10)
        const curDays = Number.isNaN(curRaw) ? 3 : curRaw
        const curLabel = curDays === 0 ? t("ttl.unlimited") : `${curDays}d`
        dialog?.replace(() => (
          <api.ui.DialogSelect
            title={`${t("ttl.label")}  (${curLabel})`}
            options={[
              { title: t("ttl.3d"), value: "3" },
              { title: t("ttl.7d"), value: "7" },
              { title: t("ttl.14d"), value: "14" },
              { title: t("ttl.30d"), value: "30" },
              { title: t("ttl.unlimited"), value: "0" },
            ]}
            onSelect={(opt) => {
              const days = parseInt(opt.value, 10)
              api.kv.set(`${KV_PREFIX}.ttl_days`, String(days))
              const msg = days === 0 ? t("ttl.toast_unlimited") : t("ttl.toast", { n: days })
              api.ui.toast({ message: msg })
              dialog?.clear()
            }}
          />
        ))
      },
    },
    {
      title: "SubAgent Magazine: Clear Entries",
      value: "subagent-clear-entries",
      description: "Delete all sub-agent records for the current session (cannot be undone)",
      slash: { name: "subagent-clear-entries" },
      onSelect: (dialog) => {
        const t = createT(() => signals.lang())
        const sid = signals.sessionId
        const sessionObj = api.state.session.get(sid)
        const parentID = (sessionObj as any)?.parentID as string | undefined
        // 检查是否存在运行中的条目
        const cached = globalEntryCache.get(sid)
        let runningCount = 0
        if (cached) {
          for (const [, e] of cached) { if (e.status === "running") runningCount++ }
        }
        const msg = runningCount > 0
          ? t("clear.prompt_running", { n: runningCount })
          : t("clear.prompt")
        dialog?.replace(() => (
          <api.ui.DialogConfirm
            title={t("clear.title")}
            message={msg}
            onConfirm={() => {
              try {
                const data = JSON.parse(String(api.kv.get(`${KV_PREFIX}.session_data`, "{}")))
                let count = 0
                if (parentID) {
                  if (data[parentID]?.children?.[sid]) {
                    const child = data[parentID].children[sid]
                    const ids = child.entries?.map((e: any) => e.id) ?? []
                    count = ids.length
                    child.entries = []
                    child.scroll = 0
                    child.expanded = ""
                    child.clearedIds = [...new Set([...(child.clearedIds ?? []), ...ids])]
                  }
                } else {
                  count = data[sid]?.entries?.length ?? 0
                  if (data[sid]) {
                    const ids = data[sid].entries?.map((e: any) => e.id) ?? []
                    data[sid].entries = []
                    data[sid].scroll = 0
                    data[sid].expanded = ""
                    data[sid].clearedIds = [...new Set([...(data[sid].clearedIds ?? []), ...ids])]
                  }
                }
                api.kv.set(`${KV_PREFIX}.session_data`, JSON.stringify(data))
                globalEntryCache.delete(sid)
                setClearTick((v) => v + 1)
                const msg = t("clear.done", { n: count })
                api.ui.toast({ message: msg })
              } catch {}
              dialog?.clear()
            }}
          />
        ))
      },
    },
  ])
}

const mod: TuiPluginModule & { id: string } = {
  id: "opencode-subagent-magazine",
  tui,
}

export default mod