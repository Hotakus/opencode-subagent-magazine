import { createSignal } from "solid-js"
import type { SubEntry } from "../core/types"

/** 模块级缓存：各 session 的 entry 状态独立存储，不随当前视图切换而清除。 */
export const globalEntryCache = new Map<string, Map<string, SubEntry>>()

/** 模块级刷新信号：外部（如斜杠命令）触发清除后 +1，组件 scan 依赖它以重扫。 */
export const [clearTick, setClearTick] = createSignal(0)
