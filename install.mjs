#!/usr/bin/env node

/**
 * Install script for opencode-subagent-monitor.
 *
 * Creates or updates `~/.config/opencode/tui.jsonc` so OpenCode loads
 * the TUI sidebar plugin.
 *
 * Usage:
 *   node install.mjs
 *   npm explore opencode-subagent-monitor -- node install.mjs
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises"
import { constants } from "node:fs"
import { homedir, platform } from "node:os"
import { join, dirname } from "node:path"

const PLUGIN_SPEC = "opencode-subagent-monitor"

function configDir() {
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "opencode")
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode")
}

async function exists(p) {
  try { await access(p, constants.F_OK); return true }
  catch { return false }
}

async function readJSONC(p) {
  const raw = await readFile(p, "utf-8")
  const stripped = raw.replace(/^\s*\/\/.*$/gm, "")
  return JSON.parse(stripped)
}

function formatJSONC(obj) {
  return JSON.stringify(obj, null, 2) + "\n"
}

function mergePlugin(existing, spec) {
  const plugins = existing.plugin ?? []
  if (plugins.some((p) => (typeof p === "string" ? p : p[0]) === spec)) {
    return false
  }
  existing.plugin = [...plugins, spec]
  return true
}

async function main() {
  const dir = configDir()
  await mkdir(dir, { recursive: true })

  // ---- tui.jsonc ----
  const tuiPath = join(dir, "tui.jsonc")
  let tuiChanged = false

  if (await exists(tuiPath)) {
    const cfg = await readJSONC(tuiPath)
    tuiChanged = mergePlugin(cfg, PLUGIN_SPEC)
    if (tuiChanged) {
      await writeFile(tuiPath, formatJSONC(cfg))
      console.log(`[opencode-subagent-monitor] Added to ${tuiPath}`)
    } else {
      console.log(`[opencode-subagent-monitor] Already in ${tuiPath}`)
    }
  } else {
    const cfg = {
      $schema: "https://opencode.ai/tui.json",
      plugin: [PLUGIN_SPEC],
    }
    await writeFile(tuiPath, formatJSONC(cfg))
    console.log(`[opencode-subagent-monitor] Created ${tuiPath}`)
    tuiChanged = true
  }

  // ---- opencode.jsonc (forward compat) ----
  const ocPath = join(dir, "opencode.jsonc")
  let ocChanged = false

  if (await exists(ocPath)) {
    const cfg = await readJSONC(ocPath)
    ocChanged = mergePlugin(cfg, PLUGIN_SPEC)
    if (ocChanged) {
      await writeFile(ocPath, formatJSONC(cfg))
      console.log(`[opencode-subagent-monitor] Also added to ${ocPath}`)
    }
  }

  // ---- done ----
  if (tuiChanged || ocChanged) {
    console.log("\nDone! Restart OpenCode to see the SubAgent Monitor sidebar panel.")
  } else {
    console.log("\nAlready installed. Restart OpenCode if you haven't yet.")
  }
}

main().catch((err) => {
  console.error("Install failed:", err.message)
  process.exit(1)
})
