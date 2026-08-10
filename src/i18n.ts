// ---------------------------------------------------------------------------
// i18n — centralized translations (aligned with opencode-visual-cache).
// Add a language by appending a table that satisfies `Translation`; the
// compiler enforces key completeness.
// ---------------------------------------------------------------------------

export type LangCode = "zh" | "en" | "ja" | "ko"

const ZH_T = {
  "panel.title": "子代理",
  "status.none": "暂无子代理",
  "agent.label": "代理",
  "status.label": "状态",
  "time.label": "耗时",
  "tokens.label": "上下文",
  "error.label": "错误",
  "model.label": "模型",
  "todo.label": "进度",
  "session.label": "会话 ID",
  "session.toast.copy": "可手动复制上方 ID",
  "session.toast.copied": "会话 ID 已复制",
  "session.toast.copy_failed": "无法访问系统剪贴板，请手动复制上方 ID",
  "open.label": "进入会话",
  "cost.label": "费用",
  "scroll.more": "更多",
  "scroll.top": "回顶",
  "scroll.bottom": "回底",
  "dismiss.label": "标记完成",
  "cancel.label": "取消",
  "status.running": "运行中",
  "status.done": "已完成",
  "status.cancelled": "已取消",
  "status.error": "错误",
  "order.desc": "降序（最新在前）",
  "order.asc": "升序（最早在前）",
  "scroll.wheel": "滚轮翻页",
  "scroll.click": "点击翻页",
  "ttl.label": "清理周期",
  "ttl.3d": "3 天",
  "ttl.7d": "7 天",
  "ttl.14d": "14 天",
  "ttl.30d": "30 天",
  "ttl.unlimited": "无期限",
  "ttl.toast": "清理周期已设为 {n} 天",
  "ttl.toast_unlimited": "清理周期已设为无期限",
  "clear.title": "确认清除",
  "clear.prompt": "确定清除当前会话所有子代理记录？此操作不可撤销。",
  "clear.prompt_running": "当前有 {n} 个运行中的子代理，清除后将不可恢复。确定继续？",
  "clear.done": "已清除 {n} 条子代理记录",
  "clear.empty": "当前会话无子代理记录",
  "cancel.no_session": "子会话 ID 不可用",
  "cancel.not_child": "目标不是子会话",
  "cancel.read_error": "无法读取会话信息",
  "cancel.outside_tree": "目标不在当前监控会话树中",
  "cancel.already_ended": "会话已结束，无需取消",
  "cancel.status_error": "无法查询会话状态",
  "cancel.sent": "已发送取消指令",
  "cancel.failed": "取消失败",
} as const

/** 结构约束：值放宽为 string，键集合来自中文表（新增语言缺 key 会编译报错）。 */
export type Translation = { [K in keyof typeof ZH_T]: string }

const EN_T: Translation = {
  "panel.title": "SubAgent",
  "status.none": "No sub-agents yet",
  "agent.label": "agent",
  "status.label": "status",
  "time.label": "time",
  "tokens.label": "tokens",
  "error.label": "error",
  "model.label": "model",
  "todo.label": "todo",
  "session.label": "session ID",
  "session.toast.copy": "Copy the ID above manually",
  "session.toast.copied": "Session ID copied",
  "session.toast.copy_failed": "Cannot access the system clipboard; copy the ID above manually",
  "open.label": "Open session",
  "cost.label": "cost",
  "scroll.more": "more",
  "scroll.top": "Top",
  "scroll.bottom": "Bottom",
  "dismiss.label": "dismiss",
  "cancel.label": "Cancel",
  "status.running": "running",
  "status.done": "done",
  "status.cancelled": "cancelled",
  "status.error": "error",
  "order.desc": "Desc (newest first)",
  "order.asc": "Asc (oldest first)",
  "scroll.wheel": "Wheel Scroll",
  "scroll.click": "Click Scroll",
  "ttl.label": "TTL (Time to Live)",
  "ttl.3d": "3 days",
  "ttl.7d": "7 days",
  "ttl.14d": "14 days",
  "ttl.30d": "30 days",
  "ttl.unlimited": "Never",
  "ttl.toast": "TTL set to {n} days",
  "ttl.toast_unlimited": "TTL set to Never",
  "clear.title": "Confirm",
  "clear.prompt": "Clear all sub-agent records for this session? This cannot be undone.",
  "clear.prompt_running": "{n} sub-agent(s) are still running. Clearing will discard them permanently. Continue?",
  "clear.done": "Cleared {n} sub-agent record(s)",
  "clear.empty": "No sub-agent records in this session",
  "cancel.no_session": "Child session ID is unavailable",
  "cancel.not_child": "Target is not a child session",
  "cancel.read_error": "Cannot read session info",
  "cancel.outside_tree": "Target is outside the monitored session tree",
  "cancel.already_ended": "Session already ended, no need to cancel",
  "cancel.status_error": "Cannot query session status",
  "cancel.sent": "Cancel instruction sent",
  "cancel.failed": "Cancellation failed",
}

const JA_T: Translation = {
  "panel.title": "サブエージェント",
  "status.none": "サブエージェントなし",
  "agent.label": "エージェント",
  "status.label": "状態",
  "time.label": "時間",
  "tokens.label": "コンテキスト",
  "error.label": "エラー",
  "model.label": "モデル",
  "todo.label": "進捗",
  "session.label": "セッション ID",
  "session.toast.copy": "上の ID を手動でコピーしてください",
  "session.toast.copied": "セッション ID をコピーしました",
  "session.toast.copy_failed": "システムのクリップボードにアクセスできないため、上の ID を手動でコピーしてください",
  "open.label": "セッションを開く",
  "cost.label": "費用",
  "scroll.more": "もっと",
  "scroll.top": "先頭へ",
  "scroll.bottom": "末尾へ",
  "dismiss.label": "完了にする",
  "cancel.label": "キャンセル",
  "status.running": "実行中",
  "status.done": "完了",
  "status.cancelled": "キャンセル済み",
  "status.error": "エラー",
  "order.desc": "降順（新しい順）",
  "order.asc": "昇順（古い順）",
  "scroll.wheel": "ホイールスクロール",
  "scroll.click": "クリックスクロール",
  "ttl.label": "保持期間",
  "ttl.3d": "3 日",
  "ttl.7d": "7 日",
  "ttl.14d": "14 日",
  "ttl.30d": "30 日",
  "ttl.unlimited": "無期限",
  "ttl.toast": "保持期間を {n} 日に設定しました",
  "ttl.toast_unlimited": "保持期間を無期限に設定しました",
  "clear.title": "削除の確認",
  "clear.prompt": "このセッションの全サブエージェント記録を削除しますか？この操作は元に戻せません。",
  "clear.prompt_running": "実行中のサブエージェントが {n} 個あります。削除すると復元できません。続行しますか？",
  "clear.done": "{n} 件のサブエージェント記録を削除しました",
  "clear.empty": "このセッションにサブエージェント記録はありません",
  "cancel.no_session": "子セッション ID が利用できません",
  "cancel.not_child": "対象は子セッションではありません",
  "cancel.read_error": "セッション情報を読み取れません",
  "cancel.outside_tree": "対象は監視対象のセッションツリー外です",
  "cancel.already_ended": "セッションは既に終了しています",
  "cancel.status_error": "セッション状態を照会できません",
  "cancel.sent": "キャンセル指示を送信しました",
  "cancel.failed": "キャンセルに失敗しました",
}

const KO_T: Translation = {
  "panel.title": "서브 에이전트",
  "status.none": "서브 에이전트 없음",
  "agent.label": "에이전트",
  "status.label": "상태",
  "time.label": "시간",
  "tokens.label": "컨텍스트",
  "error.label": "오류",
  "model.label": "모델",
  "todo.label": "진행도",
  "session.label": "세션 ID",
  "session.toast.copy": "위 ID를 수동으로 복사하세요",
  "session.toast.copied": "세션 ID가 복사되었습니다",
  "session.toast.copy_failed": "시스템 클립보드에 접근할 수 없어 위 ID를 수동으로 복사하세요",
  "open.label": "세션 열기",
  "cost.label": "비용",
  "scroll.more": "더 보기",
  "scroll.top": "맨 위로",
  "scroll.bottom": "맨 아래로",
  "dismiss.label": "완료 표시",
  "cancel.label": "취소",
  "status.running": "실행 중",
  "status.done": "완료",
  "status.cancelled": "취소됨",
  "status.error": "오류",
  "order.desc": "내림차순(최신순)",
  "order.asc": "오름차순(오래된순)",
  "scroll.wheel": "휠 스크롤",
  "scroll.click": "클릭 스크롤",
  "ttl.label": "보존 기간",
  "ttl.3d": "3일",
  "ttl.7d": "7일",
  "ttl.14d": "14일",
  "ttl.30d": "30일",
  "ttl.unlimited": "무기한",
  "ttl.toast": "보존 기간을 {n}일로 설정했습니다",
  "ttl.toast_unlimited": "보존 기간을 무기한으로 설정했습니다",
  "clear.title": "삭제 확인",
  "clear.prompt": "이 세션의 모든 서브 에이전트 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
  "clear.prompt_running": "실행 중인 서브 에이전트가 {n}개 있습니다. 삭제하면 복구할 수 없습니다. 계속하시겠습니까?",
  "clear.done": "서브 에이전트 기록 {n}개를 삭제했습니다",
  "clear.empty": "이 세션에 서브 에이전트 기록이 없습니다",
  "cancel.no_session": "하위 세션 ID를 사용할 수 없습니다",
  "cancel.not_child": "대상이 하위 세션이 아닙니다",
  "cancel.read_error": "세션 정보를 읽을 수 없습니다",
  "cancel.outside_tree": "대상이 모니터링 세션 트리 밖에 있습니다",
  "cancel.already_ended": "세션이 이미 종료되었습니다",
  "cancel.status_error": "세션 상태를 조회할 수 없습니다",
  "cancel.sent": "취소 지시를 보냈습니다",
  "cancel.failed": "취소에 실패했습니다",
}

export const LANGS: Record<LangCode, Translation> = { zh: ZH_T, en: EN_T, ja: JA_T, ko: KO_T }

/** 语言元数据：/subagent-lang 选项与自动检测共用。 */
export const LANG_META: { code: LangCode; label: string }[] = [
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
]

/**
 * 模板参数替换：`{key}` 占位符统一在此处理。
 * 未提供的参数保留原占位符，避免静默丢失。
 */
export function applyParams(tpl: string, params?: Record<string, string | number>): string {
  if (!params) return tpl
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in params ? String(params[k]) : m,
  )
}

/**
 * 宽松翻译工厂：未知 key 回退为 key 原样（兼容非翻译用途的键名透传）。
 * `getCode` 读取语言信号——在 SolidJS 渲染/memo 上下文中调用时自动建立响应式依赖。
 */
export function createT(getCode: () => LangCode) {
  return (key: string, params?: Record<string, string | number>): string =>
    applyParams(LANGS[getCode()][key as keyof Translation] ?? key, params)
}

/** 按系统 locale 自动检测语言（zh → 中文，ja → 日语，ko → 韩语，其余 → 英文）。 */
export function detectLang(): LangCode {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase()
    if (loc.startsWith("zh")) return "zh"
    if (loc.startsWith("ja")) return "ja"
    if (loc.startsWith("ko")) return "ko"
    return "en"
  } catch {
    return "en"
  }
}
