import type { Context } from "./types"
import type { PanelApi } from "../panel/panel-api"
import type { Lang, SortOrder, ScrollMode, SharedSignals, TimeFormat } from "../core/types"
import { SETTING_KEYS, readTTLDays } from "../core/kv"
import { TIME_FORMATS, TIME_FORMAT_SAMPLES } from "../core/format"
import { LANG_META, createT } from "../i18n"

/** 与侧栏设置共用的 TTL 周期：3/7/14/30 天或无限期。 */
const TTL_VALUES = [3, 7, 14, 30, 0]

/** 链式原生对话框之间的延迟，让宿主能关闭上一个对话框。 */
const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * 原生设置菜单（visual-cache 风格）：用单个选择列表展示每项设置
 * 及其当前值；选中某项会打开对应的编辑器，
 * 随后菜单重新打开，直到用户关闭（Esc / Close）。
 */
export function openSettingsMenu(context: Context, api: PanelApi, signals: SharedSignals): void {
  runSettingsMenu(context, api, signals).catch((err) => {
    try { context.ui.toast.show({ message: String(err), variant: "error" }) } catch {}
  })
}

async function runSettingsMenu(context: Context, api: PanelApi, signals: SharedSignals): Promise<void> {
  const t = createT(() => signals.lang())
  const kv = api.kv
  const onOff = (v: boolean) => (v ? t("settings.on") : t("settings.off"))
  const langLabel = () => LANG_META.find((m) => m.code === signals.lang())?.label ?? signals.lang()
  const ttlTitle = (d: number) => (d === 0 ? t("ttl.unlimited") : t(d === 3 ? "ttl.3d" : d === 7 ? "ttl.7d" : d === 14 ? "ttl.14d" : "ttl.30d"))
  const ttlLabel = () => ttlTitle(readTTLDays(kv))
  const orderLabel = () => (signals.sortOrder() === "desc" ? t("order.desc") : t("order.asc"))
  const scrollLabel = () => (signals.scrollMode() === "wheel" ? t("scroll.wheel") : t("scroll.click"))
  const toast = (item: string, value: string) =>
    context.ui.toast.show({ message: t("settings.saved", { item, value }) })

  while (true) {
    const category = t("settings.section.general")
    const choice = await context.ui.dialog.select<string>({
      title: t("settings.title"),
      options: [
        { title: t("settings.lang"), value: "lang", description: langLabel(), category },
        { title: t("settings.max"), value: "max", description: String(signals.maxEntries()), category },
        { title: t("settings.order"), value: "order", description: orderLabel(), category },
        { title: t("settings.scroll"), value: "scroll", description: scrollLabel(), category },
        { title: t("settings.ttl"), value: "ttl", description: ttlLabel(), category },
        { title: t("settings.border"), value: "border", description: onOff(signals.borderVisible()), category },
        { title: t("settings.showEntryCost"), value: "cost", description: onOff(signals.showEntryCost()), category },
        { title: t("settings.showEntryTime"), value: "time", description: onOff(signals.showEntryTime()), category },
        { title: t("settings.timeFormat"), value: "timefmt", description: TIME_FORMAT_SAMPLES[signals.timeFormat()], category },
        { title: t("settings.showEntryTokens"), value: "tokens", description: onOff(signals.showEntryTokens()), category },
        { title: t("settings.dbSync"), value: "dbsync", description: onOff(signals.dbSync()), category },
        { title: t("settings.close"), value: "close" },
      ],
    })
    if (choice === undefined || choice === "close") return

    // ── 语言 ──
    if (choice === "lang") {
      const picked = await context.ui.dialog.select<Lang>({
        title: t("settings.lang"),
        options: LANG_META.map((m) => ({ title: m.label, value: m.code })),
        current: signals.lang(),
      })
      if (picked) {
        signals.setLang(picked)
        kv.set(SETTING_KEYS.lang, picked)
        toast(t("settings.lang"), LANG_META.find((m) => m.code === picked)?.label ?? picked)
      }
    }

    // ── 最大可见条目数 ──
    if (choice === "max") {
      const val = await context.ui.dialog.prompt({
        title: t("settings.max"),
        message: "1–50",
        placeholder: String(signals.maxEntries()),
      })
      if (val !== undefined) {
        const n = parseInt(val.trim(), 10)
        if (Number.isNaN(n)) {
          context.ui.toast.show({ message: t("settings.invalid"), variant: "warning" })
        } else {
          const clamped = Math.max(1, Math.min(50, n))
          signals.setMaxEntries(clamped)
          kv.set(SETTING_KEYS.maxEntries, clamped)
          toast(t("settings.max"), String(clamped))
        }
      }
    }

    // ── 排序方式 ──
    if (choice === "order") {
      const picked = await context.ui.dialog.select<SortOrder>({
        title: t("settings.order"),
        options: [
          { title: t("order.desc"), value: "desc" },
          { title: t("order.asc"), value: "asc" },
        ],
        current: signals.sortOrder(),
      })
      if (picked) {
        signals.setSortOrder(picked)
        kv.set(SETTING_KEYS.order, picked)
        toast(t("settings.order"), picked === "desc" ? t("order.desc") : t("order.asc"))
      }
    }

    // ── 滚动模式 ──
    if (choice === "scroll") {
      const picked = await context.ui.dialog.select<ScrollMode>({
        title: t("settings.scroll"),
        options: [
          { title: t("scroll.wheel"), value: "wheel" },
          { title: t("scroll.click"), value: "click" },
        ],
        current: signals.scrollMode(),
      })
      if (picked) {
        signals.setScrollMode(picked)
        kv.set(SETTING_KEYS.scrollMode, picked)
        toast(t("settings.scroll"), picked === "wheel" ? t("scroll.wheel") : t("scroll.click"))
      }
    }

    // ── TTL / 保留期 ──
    if (choice === "ttl") {
      const picked = await context.ui.dialog.select<number>({
        title: t("settings.ttl"),
        options: TTL_VALUES.map((d) => ({ title: ttlTitle(d), value: d })),
        current: readTTLDays(kv),
      })
      if (picked !== undefined) {
        kv.set(SETTING_KEYS.ttlDays, String(picked))
        toast(t("settings.ttl"), ttlTitle(picked))
      }
    }

    // ── 边框 ──
    if (choice === "border") {
      const picked = await context.ui.dialog.select<boolean>({
        title: t("settings.border"),
        options: [
          { title: t("settings.on"), value: true },
          { title: t("settings.off"), value: false },
        ],
        current: signals.borderVisible(),
      })
      if (picked !== undefined) {
        signals.setBorderVisible(picked)
        kv.set(SETTING_KEYS.border, picked)
        toast(t("settings.border"), onOff(picked))
      }
    }

    // ── 单条目费用 ──
    if (choice === "cost") {
      const picked = await context.ui.dialog.select<boolean>({
        title: t("settings.showEntryCost"),
        options: [
          { title: t("settings.on"), value: true },
          { title: t("settings.off"), value: false },
        ],
        current: signals.showEntryCost(),
      })
      if (picked !== undefined) {
        signals.setShowEntryCost(picked)
        kv.set(SETTING_KEYS.showEntryCost, picked)
        toast(t("settings.showEntryCost"), onOff(picked))
      }
    }

    // ── 单条目时间 ──
    if (choice === "time") {
      const picked = await context.ui.dialog.select<boolean>({
        title: t("settings.showEntryTime"),
        options: [
          { title: t("settings.on"), value: true },
          { title: t("settings.off"), value: false },
        ],
        current: signals.showEntryTime(),
      })
      if (picked !== undefined) {
        signals.setShowEntryTime(picked)
        kv.set(SETTING_KEYS.showEntryTime, picked)
        toast(t("settings.showEntryTime"), onOff(picked))
      }
    }

    // ── 时间格式 ──
    if (choice === "timefmt") {
      const picked = await context.ui.dialog.select<TimeFormat>({
        title: t("settings.timeFormat"),
        options: TIME_FORMATS.map((f) => ({ title: `${f} — ${TIME_FORMAT_SAMPLES[f]}`, value: f })),
        current: signals.timeFormat(),
      })
      if (picked) {
        signals.setTimeFormat(picked)
        kv.set(SETTING_KEYS.timeFormat, picked)
        toast(t("settings.timeFormat"), TIME_FORMAT_SAMPLES[picked])
      }
    }

    // ── 单条目 token 数 ──
    if (choice === "tokens") {
      const picked = await context.ui.dialog.select<boolean>({
        title: t("settings.showEntryTokens"),
        options: [
          { title: t("settings.on"), value: true },
          { title: t("settings.off"), value: false },
        ],
        current: signals.showEntryTokens(),
      })
      if (picked !== undefined) {
        signals.setShowEntryTokens(picked)
        kv.set(SETTING_KEYS.showEntryTokens, picked)
        toast(t("settings.showEntryTokens"), onOff(picked))
      }
    }

    // ── 本地数据库补全 ──
    if (choice === "dbsync") {
      const picked = await context.ui.dialog.select<boolean>({
        title: t("settings.dbSync"),
        options: [
          { title: t("settings.on"), value: true },
          { title: t("settings.off"), value: false },
        ],
        current: signals.dbSync(),
      })
      if (picked !== undefined) {
        signals.setDbSync(picked)
        kv.set(SETTING_KEYS.dbSync, picked)
        toast(t("settings.dbSync"), onOff(picked))
      }
    }

    // 让宿主先关闭编辑器，再重新打开菜单。
    await nextTick()
  }
}
