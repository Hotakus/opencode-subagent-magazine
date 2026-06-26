<div align="center">
<strong>
    <h1>OpenCode SubAgent Magazine</h1>
    Real-time Sub-Agent Monitoring · TUI Sidebar Visualization<br>
    Adaptive Theme Colors · EN/ZH Bilingual · Data Persistence
</strong>
<br>
<br>
If you find this plugin useful, consider giving it a star ⭐ — thank you!<br>
<br>

[![GitHub](https://img.shields.io/badge/GitHub-Repository-black?style=flat-square&logo=github)](https://github.com/Hotakus/opencode-subagent-magazine)
[![Stars](https://img.shields.io/github/stars/Hotakus/opencode-subagent-magazine?style=flat-square)](https://github.com/Hotakus/opencode-subagent-magazine/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![中文](https://img.shields.io/badge/中文-README-blue?style=flat-square)](https://github.com/Hotakus/opencode-subagent-magazine/blob/master/README.md)
![NPM Version](https://img.shields.io/npm/v/opencode-subagent-magazine?style=flat-square)

</div>

---

## 1. Screenshots

<div align="center"> 
<strong>Collapsed · Quick Overview 👇</strong> <br>
<img src="https://raw.githubusercontent.com/Hotakus/opencode-subagent-magazine/master/assets/collapse.png"></img>
</div>
<div align="center"> 
<strong>Expanded · Detailed Info 👇</strong> <br>
<img src="https://raw.githubusercontent.com/Hotakus/opencode-subagent-magazine/master/assets/expand.png"></img>
</div>


---

## 2. Features

- **Real-time Status**: Running (breathing animation), done, error — color-coded dots at a glance
- **Token & Cost Tracking**: Per-sub-agent token consumption and cost summary, displayed globally in the title bar
- **Expandable Details**: Click to expand and view agent type, elapsed time, tokens, cost, model, and todo progress, with right-aligned values
- **One-click Session Jump**: `→ Open session` link in expanded view to navigate to the sub-agent's full conversation
- **Collapsible Panel**: Click title bar to collapse/expand; state persists across restarts
- **Scroll-to-Top**: `↑ Top` button at the bottom of the list for one-click return to top, with hover color change
- **TTL Auto Cleanup**: Data older than 3 days is automatically purged from KV storage
- **Language Support**: Runtime language switch via `/subagent-lang` (Chinese / English), preference persisted
- **Slash Commands**: `/subagent-lang`, `/subagent-max`, `/subagent-session`, `/subagent-version` for dynamic configuration

---

## 3. Installation

### 3.1 Method 1: OpenCode Command Install (Recommended)

Press **`Ctrl + P`** in OpenCode to open the command palette, search for **`install plugin`**, and enter:

```
opencode-subagent-magazine@latest
```

Press Enter to complete installation and configuration.

### 3.2 Method 2: Manual Install

**1. Install the plugin**

```bash
npm install -g opencode-subagent-magazine@latest
```

**2. Configure the TUI plugin**

Create or edit `~/.config/opencode/tui.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-subagent-magazine@latest"]
}
```

### 3.3 Restart OpenCode

Open any session — the SubAgent Magazine panel will appear in the sidebar.

---

## 4. Usage Guide

### 4.1 Slash Commands

The plugin supports dynamic configuration via slash commands or the command palette (`Ctrl + P`). All settings take effect immediately and are persisted:

| Command | Function | Usage |
|---------|----------|-------|
| `/subagent-lang` | Switch display language | Select Chinese or English from the list; takes effect instantly without restart |
| `/subagent-max` | Adjust max visible entries | Enter a number (default 10) to control how many sub-agent entries are shown |
| `/subagent-session` | View current session ID | Displays the current OpenCode session ID |
| `/subagent-version` | View plugin version | Displays the current plugin version |

<div align="center">
  <img src="https://raw.githubusercontent.com/Hotakus/opencode-subagent-magazine/master/assets/slash_cmds.png" alt="Slash Commands" width="49%"></img>
  <img src="https://raw.githubusercontent.com/Hotakus/opencode-subagent-magazine/master/assets/ctrlP_cmds.png" alt="Ctrl+P Command Palette" width="49%"></img>
</div>

### 4.2 Keyboard & Mouse

| Action | Description |
|--------|-------------|
| Click title bar | Collapse / Expand the panel |
| Click entry row | Expand / Collapse details |
| Scroll the list | Browse more sub-agents |
| Click `↑ Top` | Jump to top of the list |
| Click `→ Open session` | Navigate to the sub-agent's session |

### 4.3 Status Colors

| Color | Meaning |
|-------|---------|
| 🟢 Green | Done |
| 🟡 Yellow (breathing) | Running |
| 🔴 Red | Error |

---

## 5. Updating

Due to [OpenCode issue #6774](https://github.com/anomalyco/opencode/issues/6774), the plugin cache locks to the version at first install and won't auto-detect newer versions on npm.

Update steps:

**1. Clear the OpenCode plugin cache**

```powershell
# Windows
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\packages\opencode-subagent-magazine@latest"
```

```bash
# macOS / Linux
rm -rf ~/.cache/opencode/packages/opencode-subagent-magazine@latest
```

**2. Reinstall the plugin**

In OpenCode, press **`Ctrl + P`** → `install plugin` → `opencode-subagent-magazine@latest` → Enter

**3. Restart OpenCode**

---

## 6. Language Settings

### 6.1 Runtime Switching (Recommended)

Type `/subagent-lang` in the TUI and select "中文" or "English" to switch instantly without restart. The preference is persisted and restored on next launch.

### 6.2 Auto Detection

By default, the plugin auto-detects the system language. If it doesn't match your preference, switch once using `/subagent-lang` — the choice will be remembered.

---

## 7. Compatibility

The plugin is fully model-agnostic and works with all OpenCode-compatible AI models (DeepSeek / Claude / GPT, etc.).
Token data and sub-agent information are obtained through the OpenCode SDK standard interfaces.

---

## 8. License

MIT
