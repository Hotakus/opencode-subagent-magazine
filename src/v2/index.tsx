/** @jsxImportSource @opentui/solid */

import { createSignal } from "solid-js"
import type { Context, PluginModule } from "./types"
import { createPanelApi } from "./v2-panel-api"
import { makeCommands } from "./commands"
import { mapTheme } from "./theme"
import { SubAgentPanel } from "../panel/SubAgentPanel"
import type { PanelApi } from "../panel/panel-api"
import type { Lang, SortOrder, ScrollMode, SharedSignals } from "../core/types"
import { SETTING_KEYS } from "../core/kv"
import { LANG_META, detectLang } from "../i18n"

/** 面板根组件：keymap.layer 必须在组件渲染上下文注册（setup 内调用报
 *  Keymap.Provider missing），再渲染共享 SubAgentPanel。 */
function PluginRoot(props: {
  context: Context
  api: PanelApi
  signals: SharedSignals
  sessionID: string
}) {
  props.context.keymap.layer(() => ({
    mode: "global" as const,
    commands: makeCommands(props.context, props.api, props.signals),
  }))
  return (
    <SubAgentPanel
      api={props.api}
      theme={mapTheme(props.context.theme)}
      lang={props.signals.lang}
      maxEntries={props.signals.maxEntries}
      sortOrder={props.signals.sortOrder}
      scrollMode={props.signals.scrollMode}
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
    lang = langSignal
    maxEntries = maxSignal
    sortOrder = orderSignal
    scrollMode = scrollSignal

    const signals: SharedSignals = {
      lang, setLang, maxEntries, setMaxEntries, sortOrder, setSortOrder, scrollMode, setScrollMode, sessionId: "",
    }

    // 命令 layer（组件内注册——见 PluginRoot）
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
