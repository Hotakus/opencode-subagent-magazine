import { spawn } from "node:child_process"
import { platform, release } from "node:os"

export type ClipboardMethod =
  | "pbcopy"
  | "osascript"
  | "wl-copy"
  | "xclip"
  | "xsel"
  | "powershell"
  | "osc52"
  | "none"

export interface CopyTextResult {
  copied: boolean
  method: ClipboardMethod
  error?: string
}

function runWithInput(command: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    })

    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })

    child.stdin?.end(input)
  })
}

function writeOsc52(text: string): boolean {
  if (!process.stdout.isTTY) return false

  const payload = Buffer.from(text, "utf8").toString("base64")
  const sequence = `\x1b]52;c;${payload}\x07`
  const wrapped = process.env.TMUX || process.env.STY
    ? `\x1bPtmux;\x1b${sequence}\x1b\\`
    : sequence

  process.stdout.write(wrapped)
  return true
}

async function tryCommand(
  method: ClipboardMethod,
  command: string,
  args: string[],
  text: string,
): Promise<CopyTextResult | undefined> {
  try {
    await runWithInput(command, args, text)
    return { copied: true, method }
  } catch {
    return undefined
  }
}

export async function copyText(text: string): Promise<CopyTextResult> {
  if (!text) return { copied: false, method: "none", error: "empty_text" }

  const os = platform()
  const isWsl = release().toLowerCase().includes("microsoft")

  const attempts: Array<() => Promise<CopyTextResult | undefined>> = []

  if (os === "darwin") {
    attempts.push(() => tryCommand("pbcopy", "pbcopy", [], text))
    attempts.push(() =>
      tryCommand(
        "osascript",
        "osascript",
        ["-e", "set the clipboard to (read (POSIX file \"/dev/stdin\") as text)"],
        text,
      ),
    )
  }

  if (os === "linux" && isWsl) {
    attempts.push(() =>
      tryCommand(
        "powershell",
        "powershell.exe",
        [
          "-NonInteractive",
          "-NoProfile",
          "-Command",
          "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard ([Console]::In.ReadToEnd())",
        ],
        text,
      ),
    )
  } else if (os === "linux") {
    if (process.env.WAYLAND_DISPLAY) {
      attempts.push(() => tryCommand("wl-copy", "wl-copy", [], text))
    }
    attempts.push(() => tryCommand("xclip", "xclip", ["-selection", "clipboard"], text))
    attempts.push(() => tryCommand("xsel", "xsel", ["--clipboard", "--input"], text))
  }

  if (os === "win32") {
    attempts.push(() =>
      tryCommand(
        "powershell",
        "powershell.exe",
        [
          "-NonInteractive",
          "-NoProfile",
          "-Command",
          "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard ([Console]::In.ReadToEnd())",
        ],
        text,
      ),
    )
  }

  for (const attempt of attempts) {
    const result = await attempt()
    if (result) return result
  }

  try {
    if (writeOsc52(text)) return { copied: true, method: "osc52" }
  } catch {
    // Continue to the explicit failure result.
  }

  return { copied: false, method: "none", error: "clipboard_unavailable" }
}
