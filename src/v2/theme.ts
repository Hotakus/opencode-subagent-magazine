import type { Context } from "./types"

/** V2 theme → V1 形状映射（组件按 primary/text/textMuted/… 字段消费）。 */
export function mapTheme(theme: Context["theme"]): Record<string, unknown> {
  const text = theme.text
  const feedback = text.feedback
  return {
    primary: theme.hue.interactive[300],
    text: text.base ?? text.default,
    textMuted: text.muted ?? text.subdued,
    success: feedback.success.base ?? feedback.success.default,
    warning: feedback.warning.base ?? feedback.warning.default,
    error: feedback.error.base ?? feedback.error.default,
    border: text.muted ?? text.subdued,
  }
}
