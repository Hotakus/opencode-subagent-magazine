import type { Plugin, PluginModule } from "@opencode-ai/plugin"

const server: Plugin = async () => ({})

const mod: PluginModule = {
  id: "opencode-subagent-magazine",
  server,
}

export default mod
