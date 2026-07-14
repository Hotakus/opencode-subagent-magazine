<div align="center">
<strong>
    <h1>OpenCode SubAgent Magazine</h1>
    像弹匣一样装填！发射！<br><br>
    实时子代理监控 · TUI 侧边栏可视化<br>
    自适应主题色 · 低饱和设计语言 · 中/英双语 · 数据持久化
</strong>
<br>
<br>
如果你觉得这个插件不错的话，可以帮我点点小星星 ⭐，谢谢！<br>
<br>

[![GitHub](https://img.shields.io/badge/GitHub-Repository-black?style=flat-square&logo=github)](https://github.com/Hotakus/opencode-subagent-magazine)
[![Stars](https://img.shields.io/github/stars/Hotakus/opencode-subagent-magazine?style=flat-square)](https://github.com/Hotakus/opencode-subagent-magazine/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![English](https://img.shields.io/badge/English-README-blue?style=flat-square)](https://github.com/Hotakus/opencode-subagent-magazine/blob/master/README_EN.md)
![NPM Version](https://img.shields.io/npm/v/opencode-subagent-magazine?style=flat-square)

</div>

---

对 Token 缓存可视化感兴趣吗？可以试试 [opencode-visual-cache](https://github.com/Hotakus/opencode-visual-cache) 这个插件！

---

## 1. 图片展示

<div align="center"> 
<strong>折叠态 · 简洁概览👇</strong> <br>
<img src="https://raw.githubusercontent.com/Hotakus/opencode-subagent-magazine/master/assets/collapse.png"></img>
<img src="https://raw.githubusercontent.com/Hotakus/opencode-subagent-magazine/master/assets/collapse_en.png"></img>
</div>
<div align="center"> 
<strong>展开态 · 详细信息👇</strong> <br>
<img src="https://raw.githubusercontent.com/Hotakus/opencode-subagent-magazine/master/assets/expand.png"></img>
<img src="https://raw.githubusercontent.com/Hotakus/opencode-subagent-magazine/master/assets/expand_en.png"></img>
</div>


---

## 2. 功能

- **实时状态**：运行中（呼吸动画）、已完成、错误，彩色圆点一目了然
- **Token & 费用追踪**：每个子代理的 Token 消耗和费用汇总，标题栏全局显示
- **展开详情**：点击展开查看 agent 类型、状态、耗时、Token、费用、模型、进度，字段值右对齐
- **一键进入会话**：展开后点 `→ 进入会话` 跳转子代理的完整对话
- **会话 ID 展示**：展开明细显示子代理 Session ID，点击弹窗查看完整 ID 便于复制
- **手动标记完成**：展开区右侧 `- 标记完成` 按钮可手动终结卡住的僵尸条目；`/subagent-clear-running` 批量清理
- **状态字段显示**：展开区 `状态: 运行中/已完成/错误`，颜色与圆点一致，一目了然
- **折叠面板**：标题栏点击折叠/展开，状态持久化，重启后保持
- **滚动回顶/回底**：列表底部 `↑ 回顶` / `↓ 回底` 按钮一键跳转到最新条目位置，方向随排序自适应
- **可配置排序**：`/subagent-order` 支持「降序（最新在前）」和「升序（最早在前）」两种排列方式
- **翻页模式切换**：`/subagent-scroll` 可选「滚轮翻页」或「点击 more 翻页」，解决侧边栏与全局滚动冲突
- **TTL 自动清理**：可配置数据保留期限（3/7/14/30 天/无期限），每次访问自动续期，过期自动清除
- **手动清除条目**：`/subagent-clear-entries` 清除当前会话所有记录，防止历史条目扫描重建
- **语言适配**：支持 `/subagent-lang` 运行时切换中/英文，偏好持久化
- **斜杠命令**：`/subagent-lang` `/subagent-max` `/subagent-order` `/subagent-scroll` `/subagent-ttl` `/subagent-clear-entries` `/subagent-session` `/subagent-version` `/subagent-clear-running` 动态配置

---

## 3. 安装

### 3.1 方式一：OpenCode 命令安装（推荐）

在 OpenCode 中按 **`Ctrl + P`** 打开命令面板，搜索 **`install plugin`**，输入：

```
opencode-subagent-magazine@latest
```

回车即可完成安装与配置。

### 3.2 方式二：手动安装

**1. 安装插件**

```bash
npm install -g opencode-subagent-magazine@latest
```

**2. 配置 TUI 插件**

创建或编辑 `~/.config/opencode/tui.jsonc`：

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-subagent-magazine@latest"]
}
```

### 3.3 重启 OpenCode

进入任意 session，侧边栏即可看到子代理监控面板。

---

## 4. 使用指南

### 4.1 斜杠命令

插件支持通过斜杠命令或命令面板（`Ctrl + P`）动态调整配置，所有设置即时生效并持久化：

| 命令 | 功能 | 使用方式 |
|------|------|---------|
| `/subagent-lang` | 切换显示语言 | 从列表选择中文或 English，界面即时切换，无需重启 |
| `/subagent-max` | 调整最大可见条目数 | 输入数字（默认 10），控制面板最多显示多少个子代理条目 |
| `/subagent-order` | 切换排序方式 | 选择「降序（最新在前）」或「升序（最早在前）」，即时重排并跳转到最新条目 |
| `/subagent-scroll` | 切换翻页模式 | 选择「滚轮翻页」或「点击 more 翻页」，解决与全局滚动冲突 |
| `/subagent-ttl` | 设置数据保留期限 | 选择 3 天 / 7 天 / 14 天 / 30 天 / 无期限，控制 KV 自动清理间隔 |
| `/subagent-clear-entries` | 清除当前会话记录 | 确认后删除所有子代理记录，阻止扫描重建历史条目 |
| `/subagent-session` | 查看当前会话 ID | 弹出当前 OpenCode 会话 ID |
| `/subagent-version` | 查看插件版本 | 弹出当前插件版本号 |
| `/subagent-clear-running` | 批量清理僵尸条目 | 一键将所有运行中的条目标记为完成，清理卡住的旧数据 |

<div align="center">
  <img src="https://raw.githubusercontent.com/Hotakus/opencode-subagent-magazine/master/assets/slash_cmds.png" alt="斜杠命令" width="49%"></img>
  <img src="https://raw.githubusercontent.com/Hotakus/opencode-subagent-magazine/master/assets/ctrlP_cmds.png" alt="Ctrl+P 命令面板" width="49%"></img>
</div>

### 4.2 键盘 & 鼠标

| 操作 | 说明 |
|------|------|
| 点击标题栏 | 折叠 / 展开面板 |
| 点击条目行 | 展开 / 收起详情 |
| 滚轮 / 点击 `↑ more` `↓ more` | 翻页查看更多子代理（`/subagent-scroll` 切换翻页模式） |
| 点击 `↑ 回顶` / `↓ 回底` | 跳转到最新条目位置（方向随排序自适应） |
| 点击 `→ 进入会话` | 跳转子代理完整对话 |
| 点击 `ses_xxx… ⎘` | 弹窗显示完整 Session ID，可手动复制 |
| 点击 `- 标记完成` | 手动终结该条目（仅运行中时显示） |

### 4.3 状态颜色

| 颜色 | 含义 |
|------|------|
| 🟢 绿色 | 已完成 |
| 🟡 黄色（呼吸动画） | 运行中 |
| 🔴 红色 | 错误 |

---

## 5. 更新

由于 [OpenCode 已知问题 #6774](https://github.com/anomalyco/opencode/issues/6774)，插件缓存会锁死在首次安装时的版本，不会自动检测 npm 上的新版本。

更新步骤：

**1. 清除 OpenCode 插件缓存**

```powershell
# Windows
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\packages\opencode-subagent-magazine@latest"
```

```bash
# macOS / Linux
rm -rf ~/.cache/opencode/packages/opencode-subagent-magazine@latest
```

**2. 重新安装插件**

在 OpenCode 中按 **`Ctrl + P`** → `install plugin` → `opencode-subagent-magazine@latest` → 回车

**3. 重启 OpenCode**

---

## 6. 语言设置

### 6.1 运行时切换（推荐）

在 TUI 中输入 `/subagent-lang`，从弹窗选择「中文」或「English」即可即时切换，无需重启。偏好会自动持久化，下次启动自动恢复。

### 6.2 自动检测

默认自动检测系统语言。若不符合预期，用 `/subagent-lang` 手动切换一次即可，偏好会被记住。

---

## 7. 兼容性

代码完全模型无关，支持所有 OpenCode 兼容的 AI 模型（DeepSeek / Claude / GPT 等）。
Token 数据和子代理信息均通过 OpenCode SDK 标准接口获取。

---

## 8. License

MIT
