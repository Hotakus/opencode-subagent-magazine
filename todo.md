# TODO

## 1. 展开状态持久化
- 当前展开/折叠状态不记 KV，重启丢失
- 需在 `toggleExpand` 时写入 `api.kv.set("subagent_monitor.expanded.{entryId}", true)`
- `loadFromKv` 时恢复展开状态（或只记最近 N 个条目）

## 2. 子 agent 错误信息展示
- `SubEntry` 新增 `error?: string` 字段
- `handleSessionEnd` 处理 `session.error` 时读取 `session.error` 信息（可从 event 或 session 对象获取）
- 展开区：若 `status === "error"` 且 `entry.error` 存在，显示 `error: xxx` 行（红色）

## 3. 子 agent 费用显示
- `SubEntry` 新增 `cost?: number` 字段
- `handleSessionEnd` 时读取 `session.cost` 回填
- 展开区显示 `费用: $0.15`（格式参考 visual-cache 的 `fmtCost`）
- **与 visual-cache 联动方案**：
  - visual-cache 将汇率/货币符号存入 `api.kv`（`cache_panel.currency`、`cache_panel.rate`）
  - 本插件读取相同 KV key，复用用户的货币设置
  - 费用计算：从子 session 的 assistant messages 累加 `AssistantMessage.cost`，或直接读 `session.cost`
  - 格式化参考 visual-cache 的 `fmtCost(n, symbol, rate)` 逻辑

## 4. 一键折叠/展开全部
- （用户未确认，暂不实现）

## 5. 耗时相对时间
- （用户未确认，暂不实现）

## 6. 运行中动画效果
- running 状态的 dot `●` 改为周期性切换符号或颜色闪烁
- 方案 A：每 250ms 交替 `●` / `○`（利用现有 clock 100ms + 相位判断）
- 方案 B：利用 terminal 色彩相位实现呼吸效果（颜色 alpha 渐变）
- 推荐方案 A，简单且视觉反馈明确
