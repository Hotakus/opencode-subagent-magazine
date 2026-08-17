import type { Context } from "./types"

/** V2 theme → V1 形状映射（组件按 primary/text/textMuted/… 字段消费）。 */
export function mapTheme(theme: Context["theme"]): Record<string, unknown> {
  return {
    primary: theme.hue.interactive[300],
    text: theme.text.default,
    textMuted: theme.text.subdued,
    success: theme.text.feedback.success.default,
    warning: theme.text.feedback.warning.default,
    error: theme.text.feedback.error.default,
    border: theme.text.subdued,
  }
}
