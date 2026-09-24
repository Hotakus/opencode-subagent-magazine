/** @jsxImportSource @opentui/solid */

import { createSignal } from "solid-js"
import type { Context, PluginModule } from "./types"
import { createPanelApi } from "./v2-panel-api"
import { makeCommands } from "./commands"
import { mapTheme } from "./theme"
import { SubAgentPanel } from "../panel/SubAgentPanel"
import type { PanelApi } from "../panel/panel-api"
import type { Lang, SortOrder, ScrollMode, SharedSignals, TimeFormat } from "../core/types"
import { TIME_FORMATS } from "../core/format"
import { SETTING_KEYS } from "../core/kv"
import { LANG_META, detectLang } from "../i18n"

/** 命令层必须在 app 槽注册：侧栏隐藏（sidebar: auto）时命令仍需可用。 */
function CommandRoot(props: {
  context: Context
  api: PanelApi
  signals: SharedSignals
}) {
  props.context.keymap.layer(() => ({
    mode: "global" as const,
    commands: makeCommands(props.context, props.api, props.signals),
  }))
  return null
}

/** 面板根组件：渲染共享 SubAgentPanel（命令层见 CommandRoot）。 */
function PluginRoot(props: {
  context: Context
  api: PanelApi
  signals: SharedSignals
  sessionID: string
}) {
  return (
    <SubAgentPanel
      api={props.api}
      theme={mapTheme(props.context.theme)}
      lang={props.signals.lang}
      maxEntries={props.signals.maxEntries}
      sortOrder={props.signals.sortOrder}
      scrollMode={props.signals.scrollMode}
      borderVisible={props.signals.borderVisible}
      showEntryCost={props.signals.showEntryCost}
      showEntryTime={props.signals.showEntryTime}
      showEntryTokens={props.signals.showEntryTokens}
      timeFormat={props.signals.timeFormat}
      showOrigin={props.signals.showOrigin}
      sessionId={props.sessionID}
    />
  )
}

/** V2 入口：setup 创建共享信号 + PanelApi + 命令 layer + 侧边栏槽位。
 *  行为对齐 V1 tui()（信号初始值从 KV 恢复；侧边栏渲染共享 SubAgentPanel）。 */
const mod: PluginModule & { server: () => Promise<Record<string, never>> } = {
  id: "opencode-subagent-magazine",
  setup(context: Context) {
    // settings 惰性 getter（闭包引用信号变量——运行时已赋值）
    let lang!: () => Lang
    let maxEntries!: () => number
    let sortOrder!: () => SortOrder
    let scrollMode!: () => ScrollMode
    const api = createPanelApi(context, {
      lang: () => lang(),
      maxEntries: () => maxEntries(),
      sortOrder: () => sortOrder(),
      scrollMode: () => scrollMode(),
    })

    // 信号初始值从 KV 恢复（对齐 V1 tui()）
    const storedLang = String(api.kv.get(SETTING_KEYS.lang, ""))
    const initialLang: Lang =
      LANG_META.some((m) => m.code === storedLang) ? (storedLang as Lang) : detectLang()
    const [langSignal, setLang] = createSignal<Lang>(initialLang)
    const [maxSignal, setMaxEntries] = createSignal<number>(Number(api.kv.get(SETTING_KEYS.maxEntries, "10")) || 10)
    const [orderSignal, setSortOrder] = createSignal<SortOrder>(
      String(api.kv.get(SETTING_KEYS.order, "desc")) === "asc" ? "asc" : "desc",
    )
    const [scrollSignal, setScrollMode] = createSignal<ScrollMode>(
      String(api.kv.get(SETTING_KEYS.scrollMode, "wheel")) === "click" ? "click" : "wheel",
    )
    const [borderSignal, setBorderVisible] = createSignal<boolean>(
      (api.kv.get(SETTING_KEYS.border, false) as boolean) === true,
    )
    const [showEntryCostSignal, setShowEntryCost] = createSignal<boolean>(
      (api.kv.get(SETTING_KEYS.showEntryCost, false) as boolean) === true,
    )
    const [showEntryTimeSignal, setShowEntryTime] = createSignal<boolean>(
      (api.kv.get(SETTING_KEYS.showEntryTime, true) as boolean) !== false,
    )
    const [showEntryTokensSignal, setShowEntryTokens] = createSignal<boolean>(
      (api.kv.get(SETTING_KEYS.showEntryTokens, true) as boolean) !== false,
    )
    const storedTimeFormat = String(api.kv.get(SETTING_KEYS.timeFormat, "short"))
    const [timeFormatSignal, setTimeFormat] = createSignal<TimeFormat>(
      (TIME_FORMATS as readonly string[]).includes(storedTimeFormat) ? (storedTimeFormat as TimeFormat) : "short",
    )
    const [showOriginSignal, setShowOrigin] = createSignal<boolean>(
      (api.kv.get(SETTING_KEYS.showOrigin, true) as boolean) !== false,
    )
    const [dbSyncSignal, setDbSync] = createSignal<boolean>(
      (api.kv.get(SETTING_KEYS.dbSync, true) as boolean) !== false,
    )
    lang = langSignal
    maxEntries = maxSignal
    sortOrder = orderSignal
    scrollMode = scrollSignal

    const signals: SharedSignals = {
      lang, setLang, maxEntries, setMaxEntries, sortOrder, setSortOrder, scrollMode, setScrollMode, borderVisible: borderSignal, setBorderVisible,
      showEntryCost: showEntryCostSignal, setShowEntryCost,
      showEntryTime: showEntryTimeSignal, setShowEntryTime,
      showEntryTokens: showEntryTokensSignal, setShowEntryTokens,
      timeFormat: timeFormatSignal, setTimeFormat,
      showOrigin: showOriginSignal, setShowOrigin,
      dbSync: dbSyncSignal, setDbSync,
      sessionId: "",
    }

    // 命令层挂 app 槽：侧栏隐藏时斜杠命令仍需可用（见 CommandRoot）
    context.ui.slot({
      append: "app",
      render: () => (
        <CommandRoot context={context} api={api} signals={signals} />
      ),
    })

    // 侧边栏面板（共享 SubAgentPanel——V1/V2 同一组件）
    context.ui.slot({
      prepend: "sidebar.content",
      render: (props) => {
        signals.sessionId = String(props.sessionID ?? "")
        return (
          <PluginRoot
            context={context}
            api={api}
            signals={signals}
            sessionID={String(props.sessionID ?? "")}
          />
        )
      },
    })
  },
  // V1 server 空实现（兼容标记）：v2 加载 setup，V1 检测需要 server 字段识别为插件
  server: async () => ({}),
}

export default mod
